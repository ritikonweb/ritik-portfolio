/**
 * One runnable check for the agent surface.
 *
 * Everything here fails silently in production if it breaks: a rewrite that stops
 * matching, a Content-Type that reverts to text/html, a skill digest that drifts from the
 * file it is supposed to hash, an answer lookup that starts returning the fallback. None
 * of it shows up in the UI, so it needs a check that actually speaks HTTP.
 *
 * Run against a server:  npm run build && npm start
 *                        node scripts/check-agent-endpoints.mjs [baseUrl]
 */

import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const base = (process.argv[2] || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

// Vercel preview deployments sit behind Deployment Protection, which 302s every request
// to an SSO page. Without this header the checks silently grade a login screen. Get the
// secret from Vercel: Project Settings -> Deployment Protection -> Protection Bypass for
// Automation, then run with VERCEL_BYPASS=<secret>.
const BYPASS = process.env.VERCEL_BYPASS
  ? { "x-vercel-protection-bypass": process.env.VERCEL_BYPASS, "x-vercel-set-bypass-cookie": "true" }
  : {};

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}\n        ${error.message.split("\n")[0]}`);
  }
}

const get = (path, headers = {}) => fetch(`${base}${path}`, { headers: { ...BYPASS, ...headers }, redirect: "follow" });

async function rpc(path, method, params = {}) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { ...BYPASS, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  assert.equal(response.status, 200, `${path} ${method} returned ${response.status}`);
  return response.json();
}

console.log(`checking ${base}\n`);

// Fail fast with a useful message. Without this, a protected preview reports 16 confusing
// failures that all mean "you are reading a login page".
const preflight = await fetch(`${base}/robots.txt`, { headers: BYPASS, redirect: "manual" });
if (/vercel\.com\/sso-api/.test(preflight.headers.get("location") || "")) {
  console.log("Vercel Deployment Protection is on: every request redirects to SSO.");
  console.log("Set VERCEL_BYPASS=<protection bypass secret> and re-run, or check the production URL.");
  process.exit(1);
}

await check("robots.txt declares content signals", async () => {
  const response = await get("/robots.txt");
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /^Content-Signal:\s*search=yes,\s*ai-input=yes,\s*ai-train=yes$/m);
  assert.match(body, /Sitemap: https/);
});

await check("/index.md serves markdown", async () => {
  const response = await get("/index.md");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/markdown/);
  const body = await response.text();
  assert.match(body, /^# Ritik Yadav/);
  assert.match(body, /## Experience/);
});

// Vary must be checked token by token. A substring match on /accept/i passes on
// "accept-encoding", which Next adds by itself, so the original version of this check
// reported success while the Accept token was absent from the HTML response entirely.
const varies = (response) =>
  (response.headers.get("vary") || "").split(",").map((v) => v.trim().toLowerCase());

await check("GET / negotiates markdown on Accept", async () => {
  const response = await get("/", { Accept: "text/markdown" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/markdown/);
  assert.ok(varies(response).includes("accept"), `Vary lacks Accept: ${response.headers.get("vary")}`);
  assert.match(await response.text(), /^# Ritik Yadav/);
});

/**
 * The homepage returns HTML or markdown for the same URL, so a shared cache must never be
 * able to store one and serve it for the other.
 *
 * Two ways to satisfy that, and only one of them has to hold. Either the response declares
 * Vary: Accept, or it is not reusable without revalidating. Asserting Vary alone fails
 * here: `/` is statically prerendered and the App Router overwrites Vary for RSC,
 * discarding what middleware and next.config set. Asserting Cache-Control alone fails too,
 * because `next start` sends none locally and Vercel adds must-revalidate in production.
 * The invariant is the disjunction, which is what actually keeps it safe and what holds in
 * both environments.
 */
await check("GET / serves HTML that no cache can substitute for markdown", async () => {
  const response = await get("/", { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" });
  assert.match(response.headers.get("content-type") || "", /text\/html/);

  const cache = (response.headers.get("cache-control") || "").toLowerCase();
  const revalidates = cache === "" || /no-store|no-cache|max-age=0|must-revalidate/.test(cache);
  assert.ok(
    varies(response).includes("accept") || revalidates,
    `HTML is reusable from cache ("${cache}") without Vary: Accept, so a shared cache could serve it to a markdown request`,
  );
});

await check("homepage advertises Link relations", async () => {
  const response = await get("/", { Accept: "text/html" });
  const link = response.headers.get("link") || "";
  assert.match(link, /rel="api-catalog"/);
  assert.match(link, /rel="service-desc"/);
});

await check("api-catalog is a valid linkset", async () => {
  const response = await get("/.well-known/api-catalog");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /application\/linkset\+json/);
  const body = await response.json();
  assert.ok(Array.isArray(body.linkset) && body.linkset.length > 0);
  for (const entry of body.linkset) assert.match(entry.anchor, /^https:\/\//);
  assert.ok(body.linkset[0]["service-desc"][0].href.endsWith("/openapi.json"));
});

await check("openapi document describes the endpoints", async () => {
  const body = await (await get("/openapi.json")).json();
  assert.match(body.openapi, /^3\.1/);
  for (const path of ["/index.md", "/answers.json", "/api/mcp", "/api/a2a"]) {
    assert.ok(body.paths[path], `missing path ${path}`);
  }
});

await check("A2A agent card is complete", async () => {
  const card = await (await get("/.well-known/agent-card.json")).json();
  assert.ok(card.name && card.version && card.description);
  assert.ok(card.supportedInterfaces?.[0]?.url?.endsWith("/api/a2a"));
  assert.ok(card.skills.length > 0);
  for (const skill of card.skills) assert.ok(skill.id && skill.name && skill.description);
});

await check("MCP server card points at the endpoint", async () => {
  const card = await (await get("/.well-known/mcp/server-card.json")).json();
  assert.ok(card.serverInfo?.name && card.serverInfo?.version);
  assert.ok(card.endpoint.endsWith("/api/mcp"));
  assert.ok(card.capabilities?.tools);
});

await check("skills index digest matches the served SKILL.md", async () => {
  const index = await (await get("/.well-known/agent-skills/index.json")).json();
  assert.equal(index.$schema, "https://schemas.agentskills.io/discovery/0.2.0/schema.json");
  const skill = index.skills[0];
  const response = await get(new URL(skill.url).pathname);
  assert.equal(response.status, 200, `SKILL.md returned ${response.status}`);
  const body = await response.text();
  const digest = `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`;
  assert.equal(digest, skill.digest, "digest in the index does not match the file it points to");
});

await check("auth.md is discoverable", async () => {
  const body = await (await get("/auth.md")).text();
  assert.match(body, /^#\s*auth\.md/im);
});

await check("answer corpus is served as JSON", async () => {
  const body = await (await get("/answers.json")).json();
  assert.ok(Array.isArray(body) && body.length >= 20);
  for (const entry of body) assert.ok(entry.q && entry.a && Array.isArray(entry.tags));
});

await check("MCP initialize and tools/list", async () => {
  const init = await rpc("/api/mcp", "initialize", { protocolVersion: "2025-06-18" });
  assert.ok(init.result.protocolVersion);
  assert.ok(init.result.serverInfo.name);
  const list = await rpc("/api/mcp", "tools/list");
  const names = list.result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ["ask", "get_contact", "get_profile", "list_projects"]);
});

// The one piece of real logic on this surface: the answer lookup. A scorer that regressed
// would return the generic fallback instead, which is exactly what this asserts against.
await check("MCP ask matches the right answer", async () => {
  const hit = await rpc("/api/mcp", "tools/call", {
    name: "ask",
    arguments: { question: "What did Ritik do at Flow Realty?" },
  });
  const text = hit.result.content[0].text;
  assert.match(text, /Flow Realty/);
  assert.doesNotMatch(text, /No direct match/);

  const miss = await rpc("/api/mcp", "tools/call", {
    name: "ask",
    arguments: { question: "what is the melting point of tungsten" },
  });
  assert.match(miss.result.content[0].text, /No direct match/);
});

await check("MCP unknown tool reports isError, not a protocol error", async () => {
  const response = await rpc("/api/mcp", "tools/call", { name: "nope", arguments: {} });
  assert.equal(response.result.isError, true);
  assert.equal(response.error, undefined);
});

await check("A2A message/send returns a completed task", async () => {
  const response = await rpc("/api/a2a", "message/send", {
    message: { role: "user", messageId: "1", parts: [{ kind: "text", text: "Who is Ritik Yadav?" }] },
  });
  const task = response.result;
  assert.equal(task.kind, "task");
  assert.equal(task.status.state, "completed");
  assert.match(task.artifacts[0].parts[0].text, /Ritik Yadav/);
});

// The page stays readable for agents but must stay out of search listings, and it must
// not be reachable from the homepage. Both halves are easy to undo by accident.
await check("/answers/ is readable but noindex", async () => {
  const response = await get("/answers/");
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /Who is Ritik Yadav\?/);
  assert.match(body, /<meta name="robots" content="[^"]*noindex/);
});

await check("/answers/ is not linked or listed", async () => {
  const home = await (await get("/")).text();
  assert.doesNotMatch(home, /href="\/answers\/"/, "homepage still links to /answers/");
  const sitemap = await (await get("/sitemap.xml")).text();
  assert.doesNotMatch(sitemap, /\/answers\//, "sitemap still lists /answers/");
});

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
