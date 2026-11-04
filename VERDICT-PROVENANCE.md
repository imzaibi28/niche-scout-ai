# Provenance — the finiquito Muse Spark verdict

The verdict text the hosted demo serves for **calculadora de finiquito** is a genuine
Muse Spark output, not a template and not written by a person. This note records
exactly where it came from, so the claim can be checked.

## The verdict (verbatim)

> For "calculadora de finiquito" in Mexico this looks winnable on paper, with 90500 monthly searches and 7 of the top 10 domains showing a DR under 20. The reported top-10 DRs are all very low — for example 4.15, 0.09, 1.18 and the rest in the same single-digit range — which points to weak SEO competition. It is listed as not zero-click, so users do click through to calculators instead of getting the answer on Google. The main risk is incomplete evidence: the young-domains check was skipped due to a KWscanner navigation bug so we can't confirm if new sites are actually breaking in, seasonality is unknown, and the evidence list includes official Mexican government calculators you would have to compete against for trust.

## How it was generated

- **When:** 2026-10-29, during the validation session for the Mexico / Spanish / calculators run.
- **Where:** the local web shell on the builder's machine. The verdict panel's footer read
  **"Source: live · meta-models/muse-spark-open-1026"** at generation time.
- **Model:** Muse Spark Open, `meta-models/muse-spark-open-1026`, via Baseten partner
  inference credits (OpenAI-compatible endpoint), called by `verdict.mjs` with an
  evidence-only prompt.
- **Evidence it was given:** the validated run's record for finiquito — 90,500 searches/mo
  (KWscanner Global), 7 of the top 10 domains under the authority threshold, the top-10
  OpenPageRank values, not zero-click, young-domain check skipped, seasonality unknown.
  Every number in the verdict traces to that record; it was checked line-by-line against
  the evidence on the day it was generated.

## How the text was preserved

The verdict was generated in the local UI and was not written to a data file by the app.
On 2026-10-29 the builder copied the text from the live UI into the project chat, where it
remains on record with its "Source: live" footer. On 2026-11-04, with the builder's
approval, that preserved text was placed verbatim into `web-shell-submit/data/demo.json`
as finiquito's verdict (field `savedModelVerdict` marks its origin), replacing a
human-written evidence summary that had stood in its place.

## Why the demo serves it as "cached"

The Baseten hackathon credits were exhausted on 2026-11-02 (HTTP 402; the standalone
hackathon key has no workspace account to top up), so no new live verdict can be
generated. The hosted demo therefore serves this saved verdict and labels it honestly:
**Source: cached · Muse Spark Open — saved live verdict (2026-10-29)**.

## What this note is not

- No other niche in the hosted demo has a Muse verdict. The other three records carry
  clearly separate evidence summaries, and the UI labels them "cached run — no live
  model configured."
- A separate, genuine Muse verdict exists for a different keyword (calculadora
  INFONAVIT, 2026-11-02) inside the builder's experimental fork dataset. It belongs to
  that dataset, has incomplete evidence (no resolved search volume), and is **not** used
  anywhere in this submission. The two verdicts have never been interchanged.
