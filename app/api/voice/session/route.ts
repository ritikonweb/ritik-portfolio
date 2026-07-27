import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { captureServerEvent } from "@/lib/posthog-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INWORLD_HOST = "api.inworld.ai";
const ENGINE_HOST = "api-engine.inworld.ai";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_VOICE = "Ashley";
// tts-2 costs more ($25 vs $15 per 1M chars) but is the only model with the
// expressive delivery presets, so it is worth it for a human sounding voice.
const DEFAULT_TTS_MODEL = "inworld-tts-2";
// Speaking rate. 1.0 is the model default and sounds slow in conversation, but pushing
// too far past this flattens the expressive delivery and stops sounding human.
const DEFAULT_TTS_SPEED = 1.18;
const DEFAULT_STT_MODEL = "inworld/inworld-stt-1";
// "sentence" is the strategy tuned for tts-2. It keeps intonation across a whole
// sentence, unlike fast_start, without full_turn's wait for the entire reply.
const DEFAULT_SEGMENTER = "sentence";
const SEGMENTERS = new Set(["auto", "balanced", "sentence", "full_turn", "fast_start", "per_segment_context"]);

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

/**
 * Splits the Base64 "key:secret" credential from the Inworld portal.
 * Tolerates the two mistakes that are easy to make when pasting into a hosting
 * dashboard: wrapping quotes / stray newlines, and pasting the raw "key:secret"
 * pair instead of its Base64 form.
 */
function parseCredential(raw: string): ApiKey & { basic: string } {
  const cleaned = raw.replace(/\s+/g, "").replace(/^['"]|['"]$/g, "");
  if (!cleaned) throw new Error("bad_credential: empty");

  const split = (value: string): ApiKey | null => {
    const index = value.indexOf(":");
    if (index <= 0) return null;
    const key = value.slice(0, index);
    const secret = value.slice(index + 1);
    return key && secret ? { key, secret } : null;
  };

  // Already in plain "key:secret" form, so build the Basic form ourselves.
  const plain = split(cleaned);
  if (plain) return { ...plain, basic: Buffer.from(cleaned, "utf8").toString("base64") };

  const decoded = Buffer.from(cleaned, "base64").toString("utf8");
  const parsed = split(decoded);
  if (!parsed) throw new Error('bad_credential: expected base64 of "key:secret"');
  return { ...parsed, basic: cleaned };
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

type Minted = { token: string; expirationTime?: string };

async function requestToken(apiKey: ApiKey, authorization: string): Promise<Minted> {
  const response = await fetch(`https://${INWORLD_HOST}/auth/v1/tokens/token:generate`, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify({ key: apiKey.key, resources: [] }),
    cache: "no-store",
  });
  if (!response.ok) {
    // Inworld's body carries the real reason (revoked key, wrong key type, no credit).
    // Keep it in the server log only, it can echo back parts of the request.
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`${response.status} ${detail}`);
  }
  const payload = (await response.json()) as { token?: string; expirationTime?: string };
  if (!payload.token) throw new Error("200 but response had no token");
  return payload as Minted;
}

/**
 * Mints a short-lived JWT so the browser never receives the API credential.
 *
 * IW1-HMAC-SHA256 is the style these keys actually accept, verified against the live
 * endpoint, so it goes first. Basic stays as a fallback in case a future key type
 * only supports it.
 */
async function mintJwt(apiKey: ApiKey, basicCredential: string): Promise<Minted> {
  const attempts: Array<[string, string]> = [
    ["iw1-hmac", buildAuthorizationHeader(apiKey)],
    ["basic", `Basic ${basicCredential}`],
  ];

  const errors: string[] = [];
  for (const [label, authorization] of attempts) {
    try {
      return await requestToken(apiKey, authorization);
    } catch (error) {
      errors.push(`${label} -> ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`token_request_failed: ${errors.join(" | ")}`);
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
    await captureServerEvent(ip, "voice_api_rate_limited");
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
  const failures: string[] = [];
  for (let index = startAt; index < accounts.length; index += 1) {
    const account = accounts[index];
    try {
      const credential = parseCredential(account.credential);
      const jwt = await mintJwt(credential, credential.basic);
      const iceServers = await fetchIceServers(jwt.token);
      // Fire and forget. Not awaited so analytics never adds latency to the start of a
      // call, and captureServerEvent swallows its own errors so it cannot be mistaken
      // for a failed account by the catch below.
      void captureServerEvent(ip, "voice_api_session_created", { account_index: index });
      return NextResponse.json(
        {
          token: jwt.token,
          expiresAt: jwt.expirationTime ?? null,
          callsUrl: `https://${INWORLD_HOST}/v1/realtime/calls`,
          iceServers,
          model: (process.env.INWORLD_LLM_MODEL || DEFAULT_MODEL).trim(),
          ttsModel: (process.env.INWORLD_TTS_MODEL || DEFAULT_TTS_MODEL).trim(),
          ttsSpeed: (() => {
            const parsed = Number(process.env.INWORLD_TTS_SPEED);
            // Clamp so a bad value cannot make the voice unusable.
            return Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 2 ? parsed : DEFAULT_TTS_SPEED;
          })(),
          sttModel: (process.env.INWORLD_STT_MODEL || DEFAULT_STT_MODEL).trim(),
          segmenter: (() => {
            const requested = (process.env.INWORLD_TTS_SEGMENTER || "").trim();
            return SEGMENTERS.has(requested) ? requested : DEFAULT_SEGMENTER;
          })(),
          voice: account.voice,
          instructions: persona,
          accountIndex: index,
          accountCount: accounts.length,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      // Log the real cause so it is visible in the hosting logs, then try the next account.
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`account ${index + 1}/${accounts.length}: ${message}`);
      console.error(`[voice] account ${index + 1} failed: ${message}`);
    }
  }

  // Coarse code only. Enough to tell a bad paste from a rejected key without
  // leaking anything about the credential itself.
  const code = failures.some((entry) => entry.includes("bad_credential"))
    ? "bad_credential"
    : failures.some((entry) => entry.includes("401") || entry.includes("403"))
      ? "credential_rejected"
      : "upstream_error";

  return NextResponse.json(
    { error: "Could not start a voice session.", code, accountsTried: accounts.length - startAt },
    { status: 502, headers: { "Cache-Control": "no-store" } },
  );
}
