# Niche Scout AI

Find obscure, low-competition website niches with real search demand — and prove they're winnable before you spend 90 days building.

Niche Scout AI runs a full research pipeline: seed queries → SERP search → weakness scoring → authority + domain-age checks → local SERP cross-check → zero-click + seasonality filters → volume check → cluster expansion → content-gap brief → ranked report.

It doesn't guess. Every opportunity ships with evidence: which signals fired, which domains are weak, what the volume is, and what you'd need to beat.

> Built for indie SEO builders who monetize with display ads and can't afford to build on a hunch. Originally a local Node.js agent; now being rebuilt as a web app with Meta AI reasoning (see Roadmap).

## What you get from one run

- A ranked shortlist (top 20) of niches scoring 45+/100 on SERP weakness
- Hard-filter verdicts: volume > 50k/mo, 3+ weak domains in the top 10, 2+ domains under 1 year old breaking in
- Zero-click risk (does Google answer the query itself?) and 12-month seasonality flags
- A keyword cluster per winner: sibling queries + Google Autocomplete long-tails
- A content-gap brief for the top 5: what the ranking pages cover, word count to beat, freshness bar
- A diff vs. your last run, so weekly re-runs show only what moved

Example from a real run (Sep 29, 2026): 148 seed queries from cache → 10 opportunities ≥ 45 → 30 domains authority-checked → all 10 clusters expanded → report + CSV + JSON written.

## Hard filters

A niche only makes the shortlist if the evidence supports it:

| Filter | Rule | Source |
|---|---|---|
| Search volume | > 50,000 / mo | KWscanner bulk lookup (cached per keyword) |
| Weak competition | 3+ domains in top 10 with OpenPageRank ≤ 2.0 (DR < 20 proxy) | OpenPageRank bulk API |
| New entrants | 2+ domains in top 10 under 1 year old | Domain Age checker (cached per domain) |
| Zero-click | Penalty, not a hard gate (capped −30) | SERP features via Serper / Tavily heuristics |
| Seasonality | Flagged `strongly seasonal` if 12-mo Trends shows a spike | Google Trends |

Never-invent rule: if volume or authority is unknown, it says `unknown`. It never fabricates DR, volume, KD, or traffic.

## How scoring works

Base SERP weakness score (0–100) from `scorer.mjs`:

- Forum / social in top 5 → +20–35 (intent poorly served)
- Stale results, avg age > 2 yrs → +20; > 1 yr → +10
- Thin / personal domains (blogspot, wix, etc.) in top 10 → +10–20
- One small domain holding 3+ top-10 spots → +15 (contestable monopoly)
- PDFs / login-gated results → +10 (how-to intent underserved)
- News-dominated SERP (4+/10 news) → +10 (no evergreen guide)

Bonuses on top:

- 3+ weak domains (OPR ≤ 2.0) → +30
- 2+ young domains (< 1 yr) → +15

Penalties:

- Zero-click SERP features: answer box −12, converter widget −20, knowledge panel −8, video pack −8, Google-owned top 3 −5 (capped at −30 total)

Threshold is 45 by default (`config.scoreThreshold`). Tune it after your first run.

## Pipeline

| Step | File | What it does |
|---|---|---|
| 1. Seed + search | `seeds.mjs` + `tavily.mjs` + `cache.mjs` | Localized seed packs → 1 Tavily search per query (1 credit), SHA-256 file cache so re-runs are free |
| 2. Score | `scorer.mjs` | 0–100 weakness score + human-readable signals; applies learned adjustments if present |
| 3. Authority + domain age | `authority.mjs` + `kwscanner.mjs` | OpenPageRank DR proxy + domain-age check |
| 4. Local cross-check | `serper.mjs` | Re-fetches SERPs with true country targeting (`gl`/`hl`) — fixes Tavily US bias. Skips without a key |
| 4b. Zero-click | `serpfeatures.mjs` | Scores zero-click risk from SERP features, reusing the Serper payload |
| 5. Volume | `kwscanner.mjs` | Bulk volume lookup, per-keyword cache; sub-50k flagged FAIL, excluded from expansion |
| 6. Seasonality | `trends.mjs` | Google Trends 12-month check — flags seasonal spikes so they aren't mistaken for evergreen demand |
| 7. Expand | `expander.mjs` + `autocomplete.mjs` | Sibling queries + Google Autocomplete long-tails (free, unscored, for content planning) |
| 8. Content gap | `contentgap.mjs` | Fetches top pages for top 5, derives a writing brief: word count, must-cover subtopics, freshness bar |
| 9. Report | `report.mjs` | `data/report-<date>.md` + `opportunities-<date>.csv` + JSON DB + validation shortlist CSV |
| 10. Diff | `diff.mjs` | Diffs vs. previous run: new/dropped, score movers ≥ 10 pts, volume changes |

Standalone tools (no full run needed):

```bash
node kwscanner.mjs --check "sennik, mapa astral"
node kwscanner.mjs --ages "example.com, foo.pl"
node kwscanner.mjs --map            # dump dashboard elements if the volume step breaks on a UI change
node autocomplete.mjs --seed "sennik" --hl pl --gl pl --depth 2
node sitemap.mjs --domain example.pl --limit 500
node contentgap.mjs --keyword "sennik" --urls "https://a.pl/1,https://b.pl/2"
node serper.mjs --query "sennik" --gl pl --hl pl
node serpfeatures.mjs --query "precio del dolar hoy" --gl mx --hl es
node trends.mjs --keyword "sennik" --geo PL
node diff.mjs
node validate.mjs                   # winners-only report from your filled-in validation CSV
```

## Quickstart

Requirements: Node.js 24.

```bash
git clone https://github.com/<you>/niche-scout-ai.git
cd niche-scout-ai
npm install

# Optional, for the volume step:
npm install playwright
npx playwright install chromium

cp .env.example .env
# paste your keys into .env — see below
node run.mjs
```

### Keys

| Key | Required? | Where to get it |
|---|---|---|
| `TAVILY_API_KEY` | Yes | [tavily.com](https://tavily.com) — 1,000 credits/mo free, no card |
| `OPENPAGERANK_API_KEY` | Recommended | Keywords Everywhere dashboard → OpenPageRank — 30,000 domains/mo free |
| `SERPER_API_KEY` | Optional | [serper.dev](https://serper.dev) — 2,500 searches/mo free. Without it, step 4 skips silently |

The volume step uses Playwright with a saved browser session. Run `node kwscanner.mjs --login`, log in in the browser window (complete OTP if asked), press Enter in the terminal. The session is saved locally and reused. Your password is never stored.

First run: ~100–200 Tavily credits worst case; typical re-runs near zero (cache). KWscanner lookups are cached per keyword.

## Configuration

All settings live in `config.mjs`. The ones you'll touch first:

- `scoreThreshold` (default 45) — what counts as an opportunity
- `maxOpportunities` (default 20) — cap per run
- `lowAuthorityThreshold` / `lowAuthorityMinCount` / `authorityBonus` — the 3+ weak-domain rule
- `youngDomainMinCount` / `youngDomainBonus` — the young-domain rule
- `kwscanner.volumeMin` (default 50000) — the volume hard filter
- `autocomplete.enabled`, `contentgap.enabled`, `serper.enabled`, `trends.enabled`, `zeroclick.enabled` — toggle steps

Seed packs live in `seeds.mjs`. The shipped packs cover South America + Eastern Europe in local languages (validated winners + utility patterns + govt programs). Add a pack to cover a new country — no code changes needed.

## The learning loop

After each run, validate the shortlist in your SEO tool of choice and record what happened:

```bash
node feedback.mjs log --program "sennik" --country Poland --outcome won --notes "built site, 12k visits/mo"
node feedback.mjs log --program "horoskop dzienny" --country Poland --outcome dropped --notes "DR 45, too strong"
node feedback.mjs list
node learn.mjs
```

Outcomes: `won` (built + real traffic) · `lost` (built, flopped) · `testing` (in progress, excluded) · `dropped` (you passed — counts against, same as lost).

Each signal family needs ≥ 3 decided outcomes before it earns an adjustment: families winning ≥ 75% get +5, ≤ 25% get −10. The next pipeline run applies them automatically and cites them in the signals. Re-run `learn.mjs` monthly as outcomes accumulate.

## Outputs

All in `data/`:

- `report-<date>.md` — readable report with signals + evidence per opportunity
- `opportunities-<date>.csv` — opens in Excel / Sheets
- `opportunities-<date>.json` — full DB for diffs + tooling
- `*-shortlist-<date>.csv` — fill in `check_volume_gt_50k` + `check_3x_dr_under_20` by hand, then `node validate.mjs` for a winners-only report (see Pre-Push Checklist if you rename the file for public repos)
- `diff-<date>.md` — what changed since the last run

## Project structure

```
config.mjs       settings + .env loading
seeds.mjs        seed packs → queries
tavily.mjs       SERP search
cache.mjs        SHA-256 file cache
scorer.mjs       weakness scorer + learning-loop application
authority.mjs    OpenPageRank DR proxy
kwscanner.mjs    volume + domain-age via Playwright (saved session)
serper.mjs       local SERP cross-check
serpfeatures.mjs zero-click detection
trends.mjs       seasonality
expander.mjs     cluster expansion
autocomplete.mjs  Google Autocomplete long-tails
sitemap.mjs      competitor sitemap mining
contentgap.mjs   writing briefs from top pages
feedback.mjs     log outcomes
learn.mjs        re-weight scoring from outcomes
report.mjs       markdown + CSV + JSON outputs
diff.mjs         run-to-run diff
validate.mjs     winners-only report from validated CSV
run.mjs          full pipeline
```

Dependencies: `axios` only for the core pipeline. `playwright` is optional (volume + domain-age steps).

## Roadmap — Niche Scout AI web app

The hackathon build (Meta Global AI Developer Hackathon, Indie track):

- **Muse Spark** as the reasoning core — winnability verdicts + plain-language explanations with evidence citations, replacing hand-written scorer explanations
- **Muse Code** for the web UI + API build
- **Muse Image** for OG images + hero mockups in the site-skeleton output
- **SAM 3.1** for competitor screenshot gap analysis (thin content / layout gaps text scraping misses)
- Hosted web app: enter country + language + interest → ranked shortlist → build plan. Learning loop stays.

## Honest limitations

- OpenPageRank is a DR *proxy* (0–10 scale), not true Ahrefs / Semrush DR. Finalists still need a true DR check in your SEO tool.
- Volume comes from KWscanner's bulk lookup. If it fails or isn't set up, volume stays `unknown` — the agent won't invent it.
- Tavily dates power the freshness signal. If a SERP returns no dates, the scorer says so instead of guessing.
- Google Trends uses unofficial endpoints and rate-limits gracefully to `unknown`.

## License

MIT — add a `LICENSE` file with the standard MIT text before publishing.

## Disclaimer

This tool finds opportunities. It doesn't guarantee traffic, rankings, or revenue. Validate every winner with real keyword data before you build.
