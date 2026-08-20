"use client";

import { useEffect } from "react";

/**
 * WebMCP tool registration.
 *
 * Browser agents were tapping the voice button, which needs a microphone they do not
 * have, and every one of those visits ended as a voice_session_error. These tools give
 * them a text path to the same answers, so the mic stays for humans.
 *
 * Each tool proxies to /api/mcp, the same JSON-RPC endpoint remote agents use. One
 * implementation, two transports.
 */

type ToolResult = { content: Array<{ type: "text"; text: string }> };

type ModelContext = {
  registerTool: (tool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (args: Record<string, unknown>) => Promise<ToolResult>;
  }) => { unregister?: () => void } | void;
};

async function callMcp(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const response = await fetch("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const payload = (await response.json()) as { result?: ToolResult };
    return payload.result ?? { content: [{ type: "text", text: "No answer available." }] };
  } catch {
    return { content: [{ type: "text", text: "Profile lookup failed. Read https://ritik.co.in/index.md instead." }] };
  }
}

const TOOLS = [
  {
    name: "get_ritik_profile",
    description:
      "Get the full professional profile of Ritik Yadav as markdown: summary, measured results, experience at Flow Realty and Rustomjee, projects, skills and education.",
    inputSchema: { type: "object", properties: {} },
    remote: "get_profile",
  },
  {
    name: "ask_about_ritik",
    description:
      "Ask a question about Ritik Yadav: what he delivered, whether he fits a strategy, program management, business operations, chief-of-staff or AI automation role, his skills, or how to reach him.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "The question in plain language." } },
      required: ["question"],
    },
    remote: "ask",
  },
  {
    name: "get_ritik_contact",
    description: "Get Ritik Yadav's email, phone, LinkedIn, CV link and 30 minute booking link.",
    inputSchema: { type: "object", properties: {} },
    remote: "get_contact",
  },
] as const;

export default function AgentTools() {
  useEffect(() => {
    const modelContext = (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
    if (!modelContext?.registerTool) return;

    const handles: Array<{ unregister?: () => void }> = [];
    for (const tool of TOOLS) {
      try {
        const handle = modelContext.registerTool({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          execute: (args) => callMcp(tool.remote, args),
        });
        if (handle) handles.push(handle);
      } catch {
        // A partially implemented or renamed API must not break the page.
      }
    }

    return () => handles.forEach((handle) => handle.unregister?.());
  }, []);

  return null;
}
