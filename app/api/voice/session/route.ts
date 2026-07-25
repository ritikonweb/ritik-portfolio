import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INWORLD_HOST = "api.inworld.ai";
const ENGINE_HOST = "api-engine.inworld.ai";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_VOICE = "Ashley";
// tts-2 costs more ($25 vs $15 per 1M chars) but is the only model with the
// expressive delivery presets, so it is worth it for a human sounding voice.
const DEFAULT_TTS_MODEL = "inworld-tts-2";

type ApiKey = { key: string; secret: string };
type Account = { credential: string; voice: string };

/** Reads the primary account plus any numbered fallbacks (…_2, _3, …). */
function loadAccounts(): Account[] {
  const accounts: Account[] = [];
  const push = (credential?: string, voice?: string) => {
    const trimmed = (credential || "").trim();
    if (trimmed) accounts.push({ credential: trimmed, voice: (voice || "").trim() || DEFAULT_VOICE });
  };
  push(process.env.INWORLD_API_KEY, process.env.INWORLD_VOICE_ID);
  for (let i = 2; i <= 5; i += 1) {
    push(process.env[`INWORLD_API_KEY_${i}`], process.env[`INWORLD_VOICE_ID_${i}`]);
  }
  return accounts;
}

/** Splits the Base64 "key:secret" credential from the Inworld portal. */
function parseCredential(basic: string): ApiKey {
  const decoded = Buffer.from(basic, "base64").toString("utf8");
  const index = decoded.indexOf(":");
  const key = index > 0 ? decoded.slice(0, index) : "";
  const secret = index > 0 ? decoded.slice(index + 1) : "";
  if (!key || !secret) throw new Error('Credential must be base64 of "key:secret"');
  return { key, secret };
}

function getDateTime(): string {
  const [datePart, timePart] = new Date().toISOString().split("T");
  return `${datePart.replace(/-/g, "")}${timePart.replace(/:/g, "").substring(0, 6)}`;
}

/** IW1-HMAC-SHA256 signing chain, mirroring Inworld's JWT sample app. */
function buildAuthorizationHeader({ key, secret }: ApiKey): string {
  const method = "ai.inworld.engine.WorldEngine/GenerateToken";
  const datetime = getDateTime();
  const nonce = crypto.randomBytes(16).toString("hex").slice(1, 12);
  let signingKey: Buffer = Buffer.from(`IW1${secret}`, "utf8");
  for (const part of [datetime, ENGINE_HOST.replace(":443", ""), method, nonce]) {
    signingKey = crypto.createHmac("sha256", signingKey).update(part).digest();
  }
  const signature = crypto.createHmac("sha256", signingKey).update("iw1_request").digest("hex");
  return `IW1-HMAC-SHA256 ApiKey=${key},DateTime=${datetime},Nonce=${nonce},Signature=${signature}`;
}

/** Mints a short-lived JWT so the browser never receives the API credential. */
async function mintJwt(apiKey: ApiKey) {
  const response = await fetch(`https://${INWORLD_HOST}/auth/v1/tokens/token:generate`, {
    method: "POST",
    headers: { Authorization: buildAuthorizationHeader(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify({ key: apiKey.key, resources: [] }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Token request failed (${response.status})`);
  return (await response.json()) as { token: string; expirationTime?: string };
}

async function fetchIceServers(jwt: string) {
  try {
    const response = await fetch(`https://${INWORLD_HOST}/v1/realtime/ice-servers`, {
      headers: { Authorization: `Bearer ${jwt}` },
      cache: "no-store",
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { ice_servers?: unknown[] };
    return Array.isArray(data.ice_servers) ? data.ice_servers : [];
  } catch {
    return [];
  }
}

async function readPersona(): Promise<string> {
  try {
    const raw = await readFile(path.join(process.cwd(), "bot", "persona.md"), "utf8");
    return raw.replace(/<!--[\s\S]*?-->/g, "").trim();
  } catch {
    return "You are Ritik Yadav. Speak briefly and naturally, one or two sentences, no lists or markdown.";
  }
}

// Small in-memory throttle so a single visitor cannot spin up endless paid sessions.
// Serverless instances are short lived, so treat this as a speed bump, not a hard gate.
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((time) => now - time < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) {
    hits.forEach((times: number[], key: string) => {
      if (times.every((time) => now - time >= RATE_WINDOW_MS)) hits.delete(key);
    });
  }
  return recent.length > RATE_LIMIT;
}

export async function GET(request: Request) {
  const accounts = loadAccounts();
  if (accounts.length === 0) {
    return NextResponse.json({ error: "Voice is not configured yet." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many voice sessions. Try again in a few minutes." }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }

  const requested = Number(new URL(request.url).searchParams.get("account") || 0);
  const startAt = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 0;
  if (startAt >= accounts.length) {
    return NextResponse.json({ error: "Voice is unavailable right now." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  const persona = await readPersona();

  // Walk the accounts in order until one mints a token, so an exhausted or
  // broken key automatically falls through to the next.
  for (let index = startAt; index < accounts.length; index += 1) {
    const account = accounts[index];
    try {
      const jwt = await mintJwt(parseCredential(account.credential));
      const iceServers = await fetchIceServers(jwt.token);
      return NextResponse.json(
        {
          token: jwt.token,
          expiresAt: jwt.expirationTime ?? null,
          callsUrl: `https://${INWORLD_HOST}/v1/realtime/calls`,
          iceServers,
          model: (process.env.INWORLD_LLM_MODEL || DEFAULT_MODEL).trim(),
          ttsModel: (process.env.INWORLD_TTS_MODEL || DEFAULT_TTS_MODEL).trim(),
          voice: account.voice,
          instructions: persona,
          accountIndex: index,
          accountCount: accounts.length,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      // Try the next account.
    }
  }

  return NextResponse.json({ error: "Could not start a voice session." }, { status: 502, headers: { "Cache-Control": "no-store" } });
}
