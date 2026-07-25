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

type ApiKey = { key: string; secret: string };

/** Splits the Base64 "key:secret" credential from the Inworld portal. */
function resolveApiKey(): ApiKey {
  const basic = (process.env.INWORLD_API_KEY || "").trim();
  if (!basic) throw new Error("INWORLD_API_KEY is not set");
  const decoded = Buffer.from(basic, "base64").toString("utf8");
  const index = decoded.indexOf(":");
  const key = index > 0 ? decoded.slice(0, index) : "";
  const secret = index > 0 ? decoded.slice(index + 1) : "";
  if (!key || !secret) throw new Error('INWORLD_API_KEY must be base64 of "key:secret"');
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
  if (!response.ok) {
    throw new Error(`Token request failed (${response.status})`);
  }
  return (await response.json()) as { token: string; type?: string; expirationTime?: string };
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
    const file = path.join(process.cwd(), "bot", "persona.md");
    const raw = await readFile(file, "utf8");
    // Strip HTML comments so editor notes never reach the model.
    return raw.replace(/<!--[\s\S]*?-->/g, "").trim();
  } catch {
    return "You are Ritik Yadav. Speak briefly and naturally, one to three sentences, no lists or markdown.";
  }
}

export async function GET() {
  try {
    const apiKey = resolveApiKey();
    const [jwt, persona] = await Promise.all([mintJwt(apiKey), readPersona()]);
    const iceServers = await fetchIceServers(jwt.token);
    return NextResponse.json(
      {
        token: jwt.token,
        expiresAt: jwt.expirationTime ?? null,
        callsUrl: `https://${INWORLD_HOST}/v1/realtime/calls`,
        iceServers,
        model: (process.env.INWORLD_LLM_MODEL || DEFAULT_MODEL).trim(),
        voice: (process.env.INWORLD_VOICE_ID || DEFAULT_VOICE).trim(),
        instructions: persona,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voice session unavailable";
    const configIssue = message.includes("INWORLD_API_KEY");
    return NextResponse.json(
      { error: configIssue ? "Voice is not configured yet." : "Could not start a voice session." },
      { status: configIssue ? 503 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
