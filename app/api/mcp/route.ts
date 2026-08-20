import { NextResponse } from "next/server";
import site from "@/content/site.json";
import { NAME, SITE_URL, ask, profileMarkdown } from "@/lib/profile";

/**
 * Model Context Protocol server over Streamable HTTP.
 *
 * Stateless on purpose: every tool call is a pure read of content/site.json, so there is
 * no session to keep and no SSE stream to hold open. That makes it safe on serverless and
 * removes the usual reason an MCP server breaks, which is state that outlived the instance.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER = { name: "ritik-profile", title: `${NAME} Profile`, version: "1.0.0" };

const TOOLS = [
  {
    name: "get_profile",
    title: "Get profile",
    description: `Full professional profile of ${NAME} as markdown: summary, measured impact, experience, projects, skills, education.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ask",
    title: "Ask about Ritik",
    description: `Answer a natural-language question about ${NAME}: what he delivered, whether he fits a role, skills, availability, contact.`,
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "The question, in plain language." } },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    name: "list_projects",
    title: "List projects",
    description: `Products ${NAME} has built, with links.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_contact",
    title: "Get contact",
    description: `Contact details and scheduling link for ${NAME}.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

function callTool(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "get_profile":
      return profileMarkdown();
    case "ask":
      return ask(String(args.question ?? "")).answer;
    case "list_projects":
      return site.projects.items.map((p) => `- ${p.name}: ${p.description} (${p.url})`).join("\n");
    case "get_contact":
      return [
        `Name: ${NAME}`,
        `Location: ${site.identity.location}`,
        `Email: ${site.contact.email}`,
        `Phone: +91 ${site.contact.phone}`,
        `LinkedIn: ${site.contact.linkedin}`,
        `Book 30 minutes: ${site.contact.calendar}`,
        `CV: ${site.contact.resume}`,
        `Site: ${SITE_URL}`,
      ].join("\n");
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version, Accept",
  "Cache-Control": "no-store",
};

const reply = (id: unknown, result: unknown) => NextResponse.json({ jsonrpc: "2.0", id, result }, { headers: CORS });
const fail = (id: unknown, code: number, message: string) =>
  NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { headers: CORS });

export async function POST(request: Request) {
  let rpc: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    rpc = (await request.json()) as typeof rpc;
  } catch {
    return fail(null, -32700, "Parse error");
  }

  const { id = null, method = "", params = {} } = rpc;

  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: `Use these tools to answer questions about ${NAME}. Every answer is grounded in ${SITE_URL}; do not infer numbers that are not returned.`,
      });

    // Notifications carry no id and must not get a result body.
    case "notifications/initialized":
    case "notifications/cancelled":
      return new NextResponse(null, { status: 202, headers: CORS });

    case "ping":
      return reply(id, {});

    case "tools/list":
      return reply(id, { tools: TOOLS });

    case "tools/call": {
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        return reply(id, { content: [{ type: "text", text: callTool(name, args) }], isError: false });
      } catch (error) {
        // Tool failures are reported inside the result, per spec, so the model can react
        // instead of the whole request looking like a protocol error.
        return reply(id, {
          content: [{ type: "text", text: error instanceof Error ? error.message : "tool failed" }],
          isError: true,
        });
      }
    }

    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** No server-initiated messages, so there is nothing to stream. */
export async function GET() {
  return NextResponse.json(
    { error: "Use POST with JSON-RPC 2.0. Server card: /.well-known/mcp/server-card.json" },
    { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } },
  );
}
