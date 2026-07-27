/** @type {import('next').NextConfig} */
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
    ];
  },
  skipTrailingSlashRedirect: true,
  // The voice route reads bot/persona.md at runtime with a dynamic path, which the
  // build tracer cannot follow. Without this the file is missing on the server and the
  // bot silently falls back to a one line persona.
  experimental: {
    outputFileTracingIncludes: {
      "/api/voice/session/**": ["bot/persona.md"],
    },
  },
};

export default nextConfig;
