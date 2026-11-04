# Niche Scout AI

**Find low-competition website niches you can actually win — prove it with hard data, then let Muse Spark explain the call and plan the build.**

Built by Zohaib "Jonas" Majeed (Multan, Pakistan) for the Meta Global AI Developer Hackathon, Indie Developer track, theme *Build for Your World*. This is the builder's own daily workflow, productised: he builds SEO niche sites for display-ads revenue (shipped: [nombresparaff.com](https://nombresparaff.com), live since Oct 5, 2026, plus an Android app in Play closed testing), and Niche Scout AI is the research agent he uses to decide what to build next.

## Try it

- **Hosted demo (read-only):** serves one real, validated agent run — no keys needed, nothing to install.
- **Demo video (2:30):** shows a live agent search and the saved Muse Spark verdict (with the credit-exhaustion disclosure on camera), recorded on the builder's machine.
- **Run it locally:** the full agent (live searches) runs from the repo — see *Running locally* below.

## What it does

1. **Discover** — ~250 localized utility seed queries across 20 countries (calculators, converters, checkers, generators, lookup tools), searched via Tavily with a file cache.
2. **Prove winnability** — every candidate is scored on SERP weakness signals, then checked against hard evidence:
   - Search volume via KWscanner (Playwright automation of a logged-in dashboard; no public API exists)
   - Authority via OpenPageRank bulk API
   - Zero-click SERP-feature risk flags, Google Trends seasonality, autocomplete cluster expansion, and content-gap briefs from real competitor pages
3. **Explain** — Muse Spark reads *only* the collected evidence and writes a plain-language verdict: winnable or not, why, and the main risk. It is never given the chance to invent a metric — every number in a verdict traces to a tool output above.
4. **Plan** — Muse Spark's second job: a build brief (positioning, pages, must-cover sections, how to beat the current top results, first 3 actions, risks) generated from the niche's own cluster, content-gap brief, and competitor list, then saved per niche.
5. **Learn** — outcomes (won / lost / testing / dropped) are logged per niche; signal families that keep winning or losing adjust future scores.

## The criteria (a screen, not a guarantee)

- **Demand gate:** head keyword *or its keyword family* ≥ 50,000 searches/mo (40–50k is reported as *borderline*, not silently failed — a 49,500/mo keyword with 5 weak domains is a near-miss, not garbage).
- **Weak-SERP gate:** 3+ of the top 10 domains under the authority threshold **and** no unassailable giant in the top 3.
- **Risk flags, not gates:** zero-click features, seasonality, government/trust competition, low CPC, and *unknown* young-domain data (unknown is reported as unknown — never as a pass or a fail).

The filters screen; judgment over the evidence — the Muse verdict plus the builder's call — decides.

## Validated result (Mexico · Spanish · calculators, Oct 2026)

A real 20-query run (0 fresh Tavily calls — fully cached; volumes resolved 20/20):

| Keyword | Volume/mo | Weak domains (top 10) | Verdict |
|---|---|---|---|
| calculadora de finiquito | 90,500 | 7 | **Passes both filters — the winner** |
| conversor de moneda | 301,000 | 0 | Volume pass, authority fail (Wise/XE/Revolut own the SERP) |
| calculadora de IMC | 110,000 | 1 | Volume pass, authority fail |
| calculadora de embarazo | 74,000 | 1 | Volume pass, authority fail |
| calculadora de aguinaldo | 49,500 | 5 | Borderline — misses demand by 500 |

The live Muse Spark verdict on finiquito (generated Oct 29, 2026, checked line-by-line against the evidence) correctly identified the opportunity *and* the real risk: official Mexican government calculators in the top 10 that a new site must out-trust, with seasonality honestly reported as unknown. The full verdict text is preserved in `VERDICT-PROVENANCE.md` in this folder, and it is the text the hosted demo serves for finiquito — labelled "Source: cached · Muse Spark Open — saved live verdict (2026-10-29)".

## How Muse Spark is used — and the geo-block, honestly

Meta's hosted Model API is **not available from Pakistan** under Meta's Geographic Use Policy. This was confirmed by the hackathon organisers in Discord, who directed affected participants to Meta's **open-weight models via partner inference credits** and confirmed it would not count against them. This build uses exactly that route:

- **Model:** Muse Spark Open, `meta-models/muse-spark-open-1026`, served by **Baseten** (approved for $100 credits + up to 2M TPM for this hackathon), OpenAI-compatible chat completions at `https://inference.baseten.co/v1`.
- **Two jobs, both evidence-grounded:** the verdict (`web-shell/verdict.mjs`) and the build brief (`web-shell/brief.mjs`). These are the only model calls in the product.
- **Reasoning-model handling:** Muse Spark Open always reasons, and reasoning tokens count toward `max_tokens` (verified live: a 20-token test budget produced no final answer; the reasoning alone needed 78). The verdict call therefore runs 4,000 tokens with an 8,000-token retry; the brief 5,000 → 9,000. Briefs are cached to disk per niche so a niche never spends credits twice.

If no model key is configured, the demo degrades honestly: verdicts show a clearly-labeled cached verdict from the validated run, and the brief button reports that the model is not configured. Nothing is ever faked.

**Update, Nov 2, 2026:** the Baseten hackathon credits were exhausted during the build window (the API returns HTTP 402; the standalone hackathon key has no Baseten workspace account, so there is no way to add a payment method and top up). The live verdict above was generated and verified on Oct 29 while credits were available. The hosted demo therefore runs in the cached mode described here — saved, labeled verdicts and plan data — which is exactly the degradation path the product was built with. The code path for live calls is unchanged and resumes working if inference credits become available.

## Method disclosures (read these — they're deliberate)

- **"DR<20" is a proxy.** Authority is OpenPageRank (0–10 scale); domains at OPR ≤ 2.0 count as "weak (DR<20 proxy)." This is *not* Ahrefs DR, and the UI and this README say so.
- **Volumes are KWscanner Global**, because KWscanner has no Mexico database. Country-level validation (Semrush) remains a manual step in the builder's workflow.
- **Domain ages in the automated pipeline are currently unknown.** The KWscanner Tools-page age checker broke when its UI changed; the web shell offers an on-demand RDAP age check instead, and Mexico's `.mx` registry is not supported by RDAP — those ages are reported as unknown, not guessed.
- **Scores are heuristics**, not probabilities. The displayed score combines SERP-weakness signals with an authority bonus; the filters and the evidence — not the score alone — drive the decision.

## Running locally

Local version (live searches) — requirements: Node 20+, your own API keys.

1. `npm install` and `npx playwright install chromium` (agent root)
2. Create `.env` in the agent root with your own keys: `TAVILY_API_KEY`, `OPENPAGERANK_API_KEY` (create it on the OpenPageRank dashboard — a Keywords Everywhere API key will be rejected), optionally `SERPER_API_KEY`.
3. `node kwscanner.mjs --login` — sign in with *your* KWscanner account (one OTP per device; the session stays on your machine).
4. Run the agent directly (`node run.mjs --country=Mexico --category=calculators`) or start the web shell: set `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` in the same terminal (Baseten values above), then `cd web-shell && node server.mjs` → http://localhost:3000.

**Never commit `.env` or `data/kwscanner-session.json`** — both are in `.gitignore`, and the session file *is* your KWscanner account.

## Hosted demo

`web-shell-submit/` is the read-only build that gets deployed (Render config included). Live search is disabled server-side by design: it would require the builder's keys and KWscanner session, which are never hosted. Set the three `LLM_*` environment variables in the host dashboard to enable live verdicts and briefs during judging; without them the demo still works on cached/saved content, clearly labeled.

## Layout

- Agent (repo root): `run.mjs` pipeline, `seeds.mjs`, `scorer.mjs`, `authority.mjs`, `kwscanner.mjs` (patched for KWscanner's current UI, incl. its Confirm-lookup modal), `serpfeatures.mjs`, `trends.mjs`, `expander.mjs`, `contentgap.mjs`, `learn.mjs`, `report.mjs`
- Local web shell: `web-shell/` — simple 3-step UI (Search → Results → Detail), live search, RDAP domain checks, favorites, compare, CSV export, search history
- Hosted demo: `web-shell-submit/` — read-only variant above
- Model calls: `web-shell/verdict.mjs`, `web-shell/brief.mjs` — nowhere else

## Roadmap

Real behavioral test suite and a scoring audit for the experimental fork of this agent (in progress locally), RDAP domain ages inside the pipeline, Criteria v2 as implemented above, and Semrush-validated runs in more markets.
