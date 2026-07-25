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
| `INWORLD_API_KEY` | for voice bot | Inworld Base64 credential (`key:secret`) |
| `INWORLD_VOICE_ID` | optional | Cloned voice name/ID. Defaults to `Ashley` |
| `INWORLD_API_KEY_2` … `_5` | optional | Fallback accounts, used automatically if the one before runs out |
| `INWORLD_VOICE_ID_2` … `_5` | optional | Voice for each matching fallback account |
| `INWORLD_LLM_MODEL` | optional | Defaults to `openai/gpt-4o-mini` (fast, non-reasoning) |
| `INWORLD_TTS_MODEL` | optional | Defaults to `inworld-tts-1.5-mini` ($15/1M chars). Use `inworld-tts-2` for higher quality at $25 |
| `LINKEDIN_FEED_URL` | optional | Repo *variable* for the hourly LinkedIn sync workflow |

Never commit secrets. This repo is public; keys stay in Vercel only.

### CMS login setup (one time)

Create a GitHub OAuth app with:

- Homepage URL: `https://ritik.co.in`
- Callback URL: `https://ritik.co.in/api/callback`

Then set `OAUTH_GITHUB_CLIENT_ID` and `OAUTH_GITHUB_CLIENT_SECRET` in Vercel and redeploy.

## Voice bot

A minimal mic control sits in the hero button row. It uses Inworld's Realtime API
(STT + LLM router + TTS-2) over a single WebRTC session.

The browser never receives the Inworld API key. `app/api/voice/session/route.ts` signs an
IW1-HMAC-SHA256 request server-side, mints a short-lived JWT, and returns only that token
plus the persona and voice settings.

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
