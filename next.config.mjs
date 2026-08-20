/** @type {import('next').NextConfig} */

// Agent discovery documents. The App Router skips directories starting with a dot, so
// `app/.well-known/...` would never be routed. Mapping the canonical paths onto one
// handler keeps every document in a single file.
const agentDocs = [
  ["/index.md", "index-md"],
  ["/answers.json", "answers"],
  ["/openapi.json", "openapi"],
  ["/auth.md", "auth-md"],
  ["/skills/hire-ritik-yadav/SKILL.md", "skill-md"],
  ["/.well-known/api-catalog", "api-catalog"],
  ["/.well-known/security.txt", "security-txt"],
  ["/.well-known/agent-card.json", "agent-card"],
  ["/.well-known/mcp/server-card.json", "mcp-server-card"],
  ["/.well-known/agent-skills/index.json", "skills-index"],
];

const linkHeader = [
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</openapi.json>; rel="service-desc"; type="application/openapi+json"',
  '</llms-full.txt>; rel="service-doc"; type="text/plain"',
  '</index.md>; rel="describedby"; type="text/markdown"',
  '</index.md>; rel="alternate"; type="text/markdown"',
  '</.well-known/agent-card.json>; rel="describedby"; type="application/json"',
].join(", ");

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  trailingSlash: true,
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
      // Both spellings, because trailingSlash is on and clients send the extensionless
      // well-known paths either way.
      ...agentDocs.flatMap(([source, doc]) => [
        { source, destination: `/api/agent/${doc}` },
        { source: `${source}/`, destination: `/api/agent/${doc}` },
      ]),
      // Next serves the touch icon at /apple-icon.png and advertises it with a link tag,
      // which compliant clients follow. Older iOS and plenty of crawlers request these two
      // fixed paths regardless and get a 404. A rewrite is preferable to committing a
      // second copy of the same PNG under a legacy name.
      { source: "/apple-touch-icon.png", destination: "/apple-icon.png" },
      { source: "/apple-touch-icon-precomposed.png", destination: "/apple-icon.png" },
    ];
  },
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Link", value: linkHeader },
          // `/` answers with HTML or markdown depending on Accept, so a shared cache must
          // not be able to store one and hand it back for the other.
          //
          // Vary: Accept would be the obvious fix and does not work here: `/` is
          // statically prerendered and the App Router rewrites Vary for RSC, discarding
          // anything set in middleware or in this block. Link survives, Vary does not.
          // Measured, not assumed.
          //
          // So remove the reusability instead. Next's default for a static route is
          // `s-maxage=31536000`, a year of shared-cache reuse, which is what makes the
          // missing Vary dangerous. Requiring revalidation costs little on a prerendered
          // page and it is already what Vercel serves to clients today; this just makes it
          // true everywhere rather than only behind Vercel.
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
      // Agents that follow a link into a well-known document should be able to read it
      // cross-origin.
      {
        source: "/.well-known/:path*",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
  skipTrailingSlashRedirect: true,
  // The voice route reads bot/persona.md at runtime with a dynamic path, which the
  // build tracer cannot follow. Without this the file is missing on the server and the
  // bot silently falls back to a one line persona. The glob has to match the real route
  // segment, app/api/voice/agent, or the file is never bundled.
  experimental: {
    outputFileTracingIncludes: {
      "/api/voice/agent/**": ["bot/persona.md"],
    },
  },
};

export default nextConfig;
