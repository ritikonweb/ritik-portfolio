import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ask, profileMarkdown } from "@/lib/profile";

/**
 * A2A endpoint. Only `message/send` is implemented, and it completes synchronously.
 *
 * ponytail: no task store, so `tasks/get` and `tasks/cancel` are unsupported rather than
 * faked. Every request here is a read that finishes in a millisecond, so there is no
 * pending state a caller could usefully poll. If a long-running skill is ever added, the
 * upgrade path is a task table keyed by the id already returned below.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Cache-Control": "no-store",
};

type Part = { kind?: string; text?: string };

function textOf(message: unknown): string {
  const parts = (message as { parts?: Part[] } | undefined)?.parts ?? [];
  return parts
    .filter((part) => (part.kind ?? "text") === "text")
    .map((part) => part.text ?? "")
    .join(" ")
    .trim();
}

export async function POST(request: Request) {
  let rpc: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    rpc = (await request.json()) as typeof rpc;
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { headers: CORS });
  }

  const { id = null, method = "", params = {} } = rpc;

  if (method !== "message/send") {
    return NextResponse.json(
      { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}. Only message/send is supported.` } },
      { headers: CORS },
    );
  }

  const question = textOf(params.message);
  // An empty message is a request for whatever the agent has, not an error.
  const answer = question ? ask(question).answer : profileMarkdown();

  const now = new Date().toISOString();
  const contextId = String((params.message as { contextId?: string } | undefined)?.contextId ?? randomUUID());

  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id,
      result: {
        kind: "task",
        id: randomUUID(),
        contextId,
        status: { state: "completed", timestamp: now },
        artifacts: [
          {
            artifactId: randomUUID(),
            name: "answer",
            parts: [{ kind: "text", text: answer }],
          },
        ],
      },
    },
    { headers: CORS },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  return NextResponse.json(
    { error: "Use POST with JSON-RPC 2.0 message/send. Agent card: /.well-known/agent-card.json" },
    { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } },
  );
}
