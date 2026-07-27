import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { captureServerEvent } from "@/lib/posthog-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEEPGRAM_HOST = "api.deepgram.com";

// Flux is the only STT family with an end-of-turn state machine, and the multi variant
// is the only one that honours language_hints. Visitors here speak Indian English and
// often switch into Hindi mid sentence.
const DEFAULT_STT_MODEL = "flux-general-multi";
const DEFAULT_LANGUAGE_HINTS = "en,hi";
// Higher means the turn only ends when Flux is confident the speaker finished, which
// stops half sentences reaching the model. Valid range is 0.5 to 0.9.
const DEFAULT_EOT_THRESHOLD = 0.8;
const DEFAULT_EAGER_EOT = 0.6;
const DEFAULT_EOT_TIMEOUT_MS = 4000;

const DEFAULT_LLM_PROVIDER = "open_ai";
const DEFAULT_LLM_MODEL = "gpt-4o-mini";
const DEFAULT_TEMPERATURE = 0.8;

// Cartesia is Deepgram-managed, so it bills against the same credit as everything else.
// sonic-3 is the model that added expressive delivery and honours the speed, volume,
// break and emotion tags, which is what stops the voice sounding synthetic.
const DEFAULT_CARTESIA_MODEL_ID = "sonic-3";
const DEFAULT_CARTESIA_VOICE_ID = "726d5ae5-055f-4c3d-8355-d9677de68937";
// Slightly above natural. Sonic accepts 0.6 to 1.5 as a multiplier.
const DEFAULT_CARTESIA_SPEED = 1.08;
// Only used if the Cartesia voice is explicitly disabled.
const DEFAULT_TTS_MODEL = "aura-2-arcas-en";

// Deepgram's managed LLM prompt ceiling.
const MAX_PROMPT_CHARS = 25000;

// Names the transcriber would otherwise mangle.
const KEYTERMS = [
  "Ritik Yadav", "Flow Realty", "Rustomjee", "Keystone Realtors", "Ozonetel", "Gallabox",
  "Double Tick", "Zoho", "Salesforce", "InterVuex", "BrowseMind", "Aura Meetings",
  "DeepFilterNet", "NLSIU", "IIT Ropar", "IIM Amritsar", "Flipkart", "SysMind",
  "Bangalore", "crore", "lakh", "Chief of Staff",
];

// Written the way a person actually answers, not the way a product announces itself.
const GREETING = "Hey, Ritik here. So, what would you like to know?";

type Account = { key: string };

/**
 * Reads the primary key plus every numbered fallback, discovered from the environment
 * rather than a fixed range. Adding DEEPGRAM_API_KEY_4 through _9 or beyond in the
 * hosting dashboard is picked up with no code change, and gaps are tolerated.
 */
function loadAccounts(): Account[] {
  const accounts: Account[] = [];
  const push = (key?: string) => {
    const trimmed = (key || "").replace(/\s+/g, "").replace(/^['"]|['"]$/g, "");
    if (trimmed) accounts.push({ key: trimmed });
  };

  push(process.env.DEEPGRAM_API_KEY);

  const numbered = Object.keys(process.env)
    .map((name) => /^DEEPGRAM_API_KEY_(\d+)$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
    .filter((index) => Number.isFinite(index) && index >= 2)
    .sort((a, b) => a - b);

  for (const index of numbered) push(process.env[`DEEPGRAM_API_KEY_${index}`]);

  return accounts;
}

/**
 * Exchanges the API key for a short-lived JWT so the browser never receives the key.
 * Default TTL is 30 seconds, which only has to cover the WebSocket handshake, but a
 * slow mobile connection benefits from a little more headroom.
 */
class MintError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function mintToken(apiKey: string): Promise<string> {
  const attempt = async (body?: string) => {
    const headers: Record<string, string> = { Authorization: `Token ${apiKey}` };
    if (body) headers["Content-Type"] = "application/json";
    return fetch(`https://${DEEPGRAM_HOST}/v1/auth/grant`, {
      method: "POST",
      headers,
      ...(body ? { body } : {}),
      cache: "no-store",
    });
  };

  // A longer TTL is only for comfort on slow connections. If the account or plan
  // rejects the request body, fall back to the documented bare request.
  let response = await attempt(JSON.stringify({ ttl_seconds: 120 }));
  if (response.status === 400 || response.status === 422) response = await attempt();

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new MintError(response.status, `token_request_failed: ${response.status} ${detail}`);
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new MintError(200, "token_request_failed: response had no access_token");
  return payload.access_token;
}

async function readPersona(): Promise<string> {
  try {
    const raw = await readFile(path.join(process.cwd(), "bot", "persona.md"), "utf8");
    const cleaned = raw.replace(/<!--[\s\S]*?-->/g, "").trim();
    // Managed LLMs cap the system prompt, so truncate rather than have the whole
    // Settings message rejected.
    return cleaned.length > MAX_PROMPT_CHARS ? cleaned.slice(0, MAX_PROMPT_CHARS) : cleaned;
  } catch {
    return "You are Ritik Yadav. Speak briefly and naturally, two or three sentences, no lists or markdown.";
  }
}

/** Builds the TTS block. Cartesia by default, Aura-2 only if Cartesia is turned off. */
function buildSpeak() {
  const voiceId = (process.env.DEEPGRAM_TTS_VOICE_ID || DEFAULT_CARTESIA_VOICE_ID).trim();
  const provider = (process.env.DEEPGRAM_TTS_PROVIDER || "cartesia").trim();

  if (provider === "cartesia" && voiceId) {
    const requested = Number(process.env.DEEPGRAM_TTS_SPEED);
    return {
      provider: {
        type: "cartesia",
        model_id: (process.env.DEEPGRAM_TTS_MODEL_ID || DEFAULT_CARTESIA_MODEL_ID).trim(),
        voice: { mode: "id", id: voiceId },
        speed: Number.isFinite(requested) && requested >= 0.6 && requested <= 1.5 ? requested : DEFAULT_CARTESIA_SPEED,
        language: "en",
      },
    };
  }

  const speed = Number(process.env.DEEPGRAM_TTS_SPEED);
  return {
    provider: {
      type: "deepgram",
      version: "v1",
      model: (process.env.DEEPGRAM_TTS_MODEL || DEFAULT_TTS_MODEL).trim(),
      // Aura accepts 0.7 to 1.5. Slightly above natural keeps the conversation brisk.
      speed: Number.isFinite(speed) && speed >= 0.7 && speed <= 1.5 ? speed : 1.1,
    },
  };
}

function buildAgentSettings(prompt: string) {
  const clamp = (value: number, min: number, max: number, fallback: number) =>
    Number.isFinite(value) && value >= min && value <= max ? value : fallback;

  return {
    listen: {
      provider: {
        type: "deepgram",
        model: (process.env.DEEPGRAM_STT_MODEL || DEFAULT_STT_MODEL).trim(),
        // Flux models are served on v2, everything else on v1.
        version: "v2",
        language_hints: (process.env.DEEPGRAM_LANGUAGE_HINTS || DEFAULT_LANGUAGE_HINTS)
          .split(",")
          .map((hint) => hint.trim())
          .filter(Boolean),
        keyterms: KEYTERMS,
        eot_threshold: clamp(Number(process.env.DEEPGRAM_EOT_THRESHOLD), 0.5, 0.9, DEFAULT_EOT_THRESHOLD),
        // Lets the model start forming a reply before the visitor has completely
        // finished, which is most of what makes a real conversation feel responsive
        // instead of walkie-talkie. Costs a few extra LLM calls. Must stay at or below
        // eot_threshold.
        eager_eot_threshold: clamp(Number(process.env.DEEPGRAM_EAGER_EOT_THRESHOLD), 0.3, 0.9, DEFAULT_EAGER_EOT),
        eot_timeout_ms: clamp(Number(process.env.DEEPGRAM_EOT_TIMEOUT_MS), 1000, 10000, DEFAULT_EOT_TIMEOUT_MS),
      },
    },
    think: {
      provider: {
        type: (process.env.DEEPGRAM_LLM_PROVIDER || DEFAULT_LLM_PROVIDER).trim(),
        model: (process.env.DEEPGRAM_LLM_MODEL || DEFAULT_LLM_MODEL).trim(),
        temperature: clamp(Number(process.env.DEEPGRAM_LLM_TEMPERATURE), 0, 1, DEFAULT_TEMPERATURE),
      },
      prompt,
      // No endpoint, so this is a client-side function. The model calls it when the
      // visitor signals they are finished, which ends the call on a real sentence
      // instead of a timeout or a keyword guess.
      functions: [
        {
          name: "end_conversation",
          description:
            "Call this only after you have said your closing line, when the visitor has said goodbye, thanks that is all, I have to go, or otherwise signalled the conversation is over. Never call it while they are still asking things.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      ],
    },
    speak: buildSpeak(),
    greeting: GREETING,
  };
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

  const params = new URL(request.url).searchParams;
  const requested = Number(params.get("account") || 0);
  const startAt = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 0;

  // Accounts the caller already found to be out of credit. Skipping them keeps the next
  // attempt instant instead of spending a round trip on a key that will be refused.
  const skip = new Set(
    (params.get("skip") || "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value >= 0),
  );

  if (startAt >= accounts.length) {
    return NextResponse.json({ error: "Voice is unavailable right now." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  const prompt = await readPersona();
  const failures: string[] = [];
  const statuses: number[] = [];

  for (let index = startAt; index < accounts.length; index += 1) {
    if (skip.has(index)) continue;
    try {
      const token = await mintToken(accounts[index].key);
      // Fire and forget so analytics never adds latency to the start of a call.
      void captureServerEvent(ip, "voice_api_session_created", { account_index: index });
      return NextResponse.json(
        {
          token,
          agent: buildAgentSettings(prompt),
          accountIndex: index,
          accountCount: accounts.length,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof MintError) statuses.push(error.status);
      failures.push(`account ${index + 1}/${accounts.length}: ${message}`);
      console.error(`[voice] account ${index + 1} failed: ${message}`);
    }
  }

  const code = statuses.some((status) => status === 401 || status === 403)
    ? "credential_rejected"
    : statuses.includes(402)
      ? "out_of_credit"
      : "upstream_error";

  return NextResponse.json(
    {
      error: "Could not start a voice session.",
      code,
      // Upstream status codes only. Safe to expose and it is the one thing needed to
      // diagnose this without reading the hosting logs.
      upstreamStatus: statuses,
      // Failure reasons with the account label stripped. Never contains the credential.
      reasons: failures.map((entry) => entry.replace(/^account \d+\/\d+: /, "").slice(0, 200)),
      accountsTried: accounts.length - startAt,
    },
    { status: 502, headers: { "Cache-Control": "no-store" } },
  );
}
