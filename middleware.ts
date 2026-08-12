import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host");

  if (hostname === "linkedin.ritik.co.in") {
    return NextResponse.redirect(
      "https://www.linkedin.com/in/yadavritik/",
      301
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
