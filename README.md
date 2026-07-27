# ritik.co.in

Personal site for Ritik Yadav. Next.js 14 App Router, React 18, TypeScript, Tailwind, deployed on Vercel.

## Editing content (no code needed)

All site copy lives in `content/site.json` and is editable through the CMS at:

```
https://ritik.co.in/cms/
```

The CMS is `noindex` and blocked in `robots.txt`, so it never shows up in Google.
Saving in the CMS commits to `main`, which triggers a Vercel deploy.

The voice bot's script lives in `bot/persona.md`. Edit that file to change what the bot
knows and how it speaks. It is read server-side on each voice session request.

## Environment variables (set in Vercel → Settings → Environment Variables)

| Variable | Required | Purpose |
| --- | --- | --- |
| `OAUTH_GITHUB_CLIENT_ID` | for CMS login | GitHub OAuth app client ID |
| `OAUTH_GITHUB_CLIENT_SECRET` | for CMS login | GitHub OAuth app client secret |
| `DEEPGRAM_API_KEY` | for voice bot | Deepgram API key, Member permission or higher |
| `DEEPGRAM_API_KEY_2` … `_n` | optional | Fallback keys, used automatically if the one before is refused. Any number, discovered from the environment |
| `DEEPGRAM_TTS_VOICE_ID` | optional | Cartesia voice id. Setting this switches TTS to Cartesia, which is Deepgram-managed and billed to the same credit |
| `DEEPGRAM_TTS_MODEL_ID` | optional | Cartesia model, defaults to `sonic-2` |
| `DEEPGRAM_TTS_MODEL` | optional | Aura voice used when no Cartesia voice id is set. Defaults to `aura-2-arcas-en` |
| `DEEPGRAM_TTS_PROVIDER` | optional | `deepgram` or `cartesia`. Inferred from whether a voice id is present |
| `DEEPGRAM_TTS_SPEED` | optional | Aura accepts 0.7 to 1.5 (default 1.1). Cartesia accepts `slowest`…`fastest` (default `normal`) |
| `DEEPGRAM_STT_MODEL` | optional | Defaults to `flux-general-multi`, the only model honouring language hints |
| `DEEPGRAM_LANGUAGE_HINTS` | optional | Comma separated, defaults to `en,hi` |
| `DEEPGRAM_EOT_THRESHOLD` | optional | Flux end-of-turn confidence, 0.5 to 0.9. Defaults to `0.8` |
| `DEEPGRAM_EOT_TIMEOUT_MS` | optional | Hard turn timeout, defaults to `4000` |
| `DEEPGRAM_LLM_PROVIDER` | optional | Defaults to `open_ai`. `anthropic` is also managed |
| `DEEPGRAM_LLM_MODEL` | optional | Defaults to `gpt-4o-mini` |
| `DEEPGRAM_LLM_TEMPERATURE` | optional | Defaults to `0.8` |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | optional | Analytics and voice transcript storage |
| `NEXT_PUBLIC_POSTHOG_HOST` | optional | PostHog host |
| `LINKEDIN_FEED_URL` | optional | Repo *variable* for the hourly LinkedIn sync workflow |

Never commit secrets. This repo is public; keys stay in Vercel only.

### CMS login setup (one time)

Create a GitHub OAuth app with:

- Homepage URL: `https://ritik.co.in`
- Callback URL: `https://ritik.co.in/api/callback`

Then set `OAUTH_GITHUB_CLIENT_ID` and `OAUTH_GITHUB_CLIENT_SECRET` in Vercel and redeploy.

## Voice bot

A minimal mic control sits in the hero button row, built on Deepgram's Voice Agent API
(Flux STT, a managed LLM, and Aura-2 or Cartesia TTS) over a single WebSocket, using the
official `@deepgram/agents` browser SDK for capture, playback and barge-in.

The browser never receives the API key. `app/api/voice/agent/route.ts` exchanges it for a
short-lived JWT via `POST /v1/auth/grant` and returns only that token plus the agent
settings. The SDK re-requests a fresh token before every reconnect.

Guards and behaviour worth knowing:

- The system prompt is `bot/persona.md`, read at request time and truncated to Deepgram's
  25,000 character limit. `next.config.mjs` traces the file into the serverless bundle.
- Cost guards: auto-stop after 15s of silence, a 4 minute hard cap, and 12 sessions per IP
  per 5 minutes.
- The agent ends the call itself through an `end_conversation` client-side function once the
  visitor says goodbye, with a keyword backstop in the widget.
- Multiple keys fail over silently. A 402 marks that key dead for the tab and it is sent as
  a `skip` list so later attempts do not retry it.
- Finished conversations POST to `/api/voice/transcript` and are stored as a PostHog
  `voice_transcript` event. The widget shows a disclosure line while connected; remove both
  together if you drop transcripts.
- TTS is English only on Aura-2 and Cartesia, so the persona instructs the agent to
  understand Hindi input and always reply in English.

## Local development

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run build
```

For local CMS editing without GitHub auth, run `npx decap-server` alongside `npm run dev`
(`local_backend: true` is already set in `public/cms/config.yml`).

## Notes

- Hero portraits are served through Next's image optimizer as AVIF/WebP. Keep the two
  source images in `public/images/` at identical dimensions, or the reveal effect will misalign.
- `public/images/hero-grid-mask.png` keeps the background grid off the face and shirt.
  Regenerate it with `scripts/gridmask.ps1` if the portrait changes.
