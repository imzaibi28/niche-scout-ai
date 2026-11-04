# Deploy the hosted demo (Render, free)

This folder is the read-only submission demo. It serves the validated
Mexico run, with live Muse Spark verdicts/briefs when you give it the
Baseten key as a host environment variable. Live search stays disabled
by design — it needs your local agent, keys, and KWscanner session.

## Steps
1. Push this `web-shell-submit` folder to your GitHub repo
   (github.com/imzaibi28/niche-scout-ai) as its own folder.
   Check `git status` output before committing: it must NOT list
   `.env` or `data/kwscanner-session.json` (neither lives in this
   folder — keep it that way).
2. Render dashboard → New → Web Service → connect the repo.
   - Root Directory: `web-shell-submit`
   - Runtime: Node, Plan: Free
   - Build Command: (leave empty)
   - Start Command: `node server.mjs`
   (The included `render.yaml` sets the same values if you use
   New → Blueprint instead.)
3. Environment variables: **set NONE for this submission.** The
   Baseten hackathon credits were exhausted during the build window
   (HTTP 402, and the standalone hackathon key has no workspace
   account to top up), so the demo deliberately runs in cached mode:
   verdicts serve the saved, labeled verdicts from the validated run.
   If working inference credits ever become available again, the
   three `LLM_*` variables (BASE_URL / MODEL / API_KEY) go here in
   the Render dashboard only — never in Git, never in chat — and the
   same package will serve live verdicts with no code change.
4. Deploy. Open the URL, click Search, open finiquito:
   the verdict must show the Muse Spark text and say "Source:
   cached · Muse Spark Open — saved live verdict (2026-10-29)".
   "Cached" is correct for this submission — do not expect "live". Open the site once more right
   before submitting — free services sleep, and the first open wakes
   them (30–60s).

## If Render asks for a card or fails
Use Railway or Fly.io the same way (start command `node server.mjs`,
same three env vars). Do NOT fall back to hosting the local
live-search version — it would expose your keys and KWscanner session.
