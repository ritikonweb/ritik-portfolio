import { NextResponse } from "next/server";
import { captureServerEvent } from "@/lib/posthog-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Guards so a bad or hostile client cannot post an unbounded payload.
const MAX_TURNS = 80;
const MAX_TEXT = 1200;
const MAX_BODY_BYTES = 60000;

type Turn = { role: "visitor" | "ritik"; text: string };

/**
 * Stores a finished voice conversation.
 *
 * Transcripts go to PostHog as a single `voice_transcript` event. That is deliberate:
 * committing them to the GitHub repo would put visitor speech into public source
 * control, rewrite the same file on every call, and race with the CMS commits that
 * land on main independently.
 */
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  let payload: { startedAt?: string; endedAt?: string; turns?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const turns: Turn[] = Array.isArray(payload.turns)
    ? payload.turns
        .filter((turn): turn is Turn => {
          if (!turn || typeof turn !== "object") return false;
          const candidate = turn as { role?: unknown; text?: unknown };
          return (candidate.role === "visitor" || candidate.role === "ritik") && typeof candidate.text === "string";
        })
        .slice(0, MAX_TURNS)
        .map((turn) => ({ role: turn.role, text: turn.text.slice(0, MAX_TEXT) }))
    : [];

  if (turns.length < 2) {
    return NextResponse.json({ ok: true, stored: false }, { headers: { "Cache-Control": "no-store" } });
  }

  const visitorTurns = turns.filter((turn) => turn.role === "visitor");
  const readable = turns.map((turn) => `${turn.role === "visitor" ? "Visitor" : "Ritik"}: ${turn.text}`).join("\n");

  await captureServerEvent(ip, "voice_transcript", {
    started_at: typeof payload.startedAt === "string" ? payload.startedAt : null,
    ended_at: typeof payload.endedAt === "string" ? payload.endedAt : null,
    turn_count: turns.length,
    visitor_turn_count: visitorTurns.length,
    // First thing they asked is the single most useful field when reviewing these later.
    opening_question: visitorTurns[0]?.text ?? null,
    transcript: readable,
    turns,
  });

  // Also mirrored to the server log, so it is readable in the hosting logs even if
  // analytics is unconfigured.
  console.log(`[voice] transcript stored, ${turns.length} turns\n${readable}`);

  return NextResponse.json({ ok: true, stored: true }, { headers: { "Cache-Control": "no-store" } });
}
