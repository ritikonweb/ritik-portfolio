import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Starts the GitHub OAuth flow for the Decap CMS editor.
export async function GET(request: Request) {
  const clientId = process.env.OAUTH_GITHUB_CLIENT_ID;
  if (!clientId) {
    return new NextResponse("OAuth is not configured. Set OAUTH_GITHUB_CLIENT_ID.", { status: 500 });
  }
  const origin = new URL(request.url).origin;
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", `${origin}/api/callback`);
  authorize.searchParams.set("scope", "repo,user");
  authorize.searchParams.set("state", crypto.randomUUID());
  return NextResponse.redirect(authorize.toString());
}
