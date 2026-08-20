import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Quality value for a media type in an Accept header, or 0 if it is not offered. */
function quality(accept: string, type: string): number {
  for (const entry of accept.split(",")) {
    const [media, ...params] = entry.trim().split(";");
    if (media.trim().toLowerCase() !== type) continue;
    const q = params.map((p) => /^\s*q=([\d.]+)/i.exec(p)).find(Boolean);
    return q ? Number(q[1]) : 1;
  }
  return 0;
}

export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host");

  if (hostname === "linkedin.ritik.co.in") {
    return NextResponse.redirect(
      "https://www.linkedin.com/in/yadavritik/",
      301
    );
  }

  // Content negotiation for agents. A caller that asks for markdown more strongly than
  // HTML gets the markdown profile at the same URL; browsers send text/html at q=1 and
  // no markdown at all, so they are unaffected. Compared by q rather than by presence,
  // because plenty of clients list every type they can technically parse.
  const path = request.nextUrl.pathname;
  if (path === "/" || path === "") {
    const accept = request.headers.get("accept") || "";
    const wantsMarkdown =
      quality(accept, "text/markdown") > Math.max(quality(accept, "text/html"), quality(accept, "application/xhtml+xml"));

    // `Vary: Accept` is set in next.config.mjs for this path, and again by the markdown
    // route itself, because a rewrite does not carry response headers set here.
    if (wantsMarkdown) return NextResponse.rewrite(new URL("/api/agent/index-md", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
