export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Completes the GitHub OAuth flow and hands the token back to the Decap CMS window.
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  const clientId = process.env.OAUTH_GITHUB_CLIENT_ID;
  const clientSecret = process.env.OAUTH_GITHUB_CLIENT_SECRET;

  const page = (status: "success" | "error", payload: unknown) => `<!doctype html><html><head><meta charset="utf-8" /></head><body>
<p>Completing sign in...</p>
<script>
(function () {
  var message = 'authorization:github:${status}:' + JSON.stringify(${JSON.stringify(payload)});
  function send(target) { if (window.opener) window.opener.postMessage(message, target); }
  window.addEventListener('message', function () { send('*'); }, false);
  if (window.opener) window.opener.postMessage('authorizing:github', '*');
  setTimeout(function () { send('*'); }, 400);
})();
</script>
</body></html>`;

  if (!code || !clientId || !clientSecret) {
    return new Response(page("error", { error: "Missing OAuth configuration or code." }), { status: 400, headers: { "content-type": "text/html" } });
  }

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const data = (await tokenResponse.json()) as { access_token?: string; error_description?: string };
    if (!data.access_token) {
      return new Response(page("error", { error: data.error_description || "Token exchange failed." }), { status: 401, headers: { "content-type": "text/html" } });
    }
    return new Response(page("success", { token: data.access_token, provider: "github" }), { headers: { "content-type": "text/html" } });
  } catch {
    return new Response(page("error", { error: "OAuth request failed." }), { status: 500, headers: { "content-type": "text/html" } });
  }
}
