// Full pipeline: seeds -> search -> score -> authority -> serper -> zero-click ->
// volume -> seasonality -> expand -> content-gap -> report -> diff.
// Usage: node run.mjs
import { mkdirSync } from 'fs';
import { config } from './config.mjs';
import { buildQueries } from './seeds.mjs';
import { tavilySearch } from './tavily.mjs';
import { cacheGet, cacheSet } from './cache.mjs';
import { scoreSerp, applyLearnedAdjustments } from './scorer.mjs';
import { fetchAuthority, applyAuthorityBonus } from './authority.mjs';
import { crossCheckSerp } from './serper.mjs';
import { analyzeZeroClick, applyZeroClickPenalty } from './serpfeatures.mjs';
import { attachVolumes, attachDomainAges } from './kwscanner.mjs';
import { checkSeasonality } from './trends.mjs';
import { expandCluster } from './expander.mjs';
import { expandWithAutocomplete, localeFor } from './autocomplete.mjs';
import { analyzeContent } from './contentgap.mjs';
import { diffWithPrevious } from './diff.mjs';
import { writeOutputs } from './report.mjs';
import { sleep, domainOf } from './util.mjs';

mkdirSync(config.dataDir, { recursive: true });
let freshCalls = 0;

async function searchCached(query) {
  const hit = cacheGet(query);
  if (hit) return hit.payload;
  await sleep(config.delayMs);
  const payload = await tavilySearch(query);
  cacheSet(query, payload);
  freshCalls++;
  return payload;
}

// [1/10] Seed + search
const queries = buildQueries();
console.log(`[1/10] Searching ${queries.length} seed queries...`);
const scored = [];
for (const [i, q] of queries.entries()) {
  try {
    const payload = await searchCached(q.query);
    const raw = scoreSerp(q.query, payload.results || []);
    // Learning loop: past outcomes re-weight the score (no-op until learn.mjs runs)
    const { score, signals } = applyLearnedAdjustments(raw, config.dataDir);
    scored.push({ ...q, score, signals, topResults: (payload.results || []).slice(0, 10) });
    if ((i + 1) % 20 === 0) console.log(`  ...${i + 1}/${queries.length}`);
  } catch (e) {
    console.error(`FAILED ${q.query}: ${e.message}`);
  }
}

// [2/10] Filter opportunities
const opportunities = scored
  .filter((s) => s.score >= config.scoreThreshold)
  .sort((a, b) => b.score - a.score)
  .slice(0, config.maxOpportunities);
console.log(`[2/10] ${opportunities.length} opportunities scored >= ${config.scoreThreshold}`);

// [3/10] Authority check — OpenPageRank proxy for the DR<20 rule
const allDomains = [
  ...new Set(opportunities.flatMap((o) => (o.topResults || []).map((r) => domainOf(r.url)))),
].filter(Boolean);
console.log(`[3/10] Checking authority for ${allDomains.length} domains...`);
const authority = await fetchAuthority(allDomains);
for (const o of opportunities) {
  const { bonus, signal, lowCount, scored: domainScores } = applyAuthorityBonus(o, authority, config);
  o.score = Math.min(o.score + bonus, 100);
  if (signal) o.signals.push(signal);
  o.domainAuthority = domainScores;
  o.lowAuthorityCount = lowCount;
}
opportunities.sort((a, b) => b.score - a.score);
const weakCount = opportunities.filter((o) => o.lowAuthorityCount >= config.lowAuthorityMinCount).length;
console.log(`  ${weakCount}/${opportunities.length} hit the ${config.lowAuthorityMinCount}+ weak-domain rule`);

// [3b/10] Domain age — KWscanner's free Domain Age Checker. 2+ domains under
// 1 year old in the top 10 = new sites are breaking in (strongest entry signal).
// Cached per domain; skips gracefully when the checker is unreachable.
console.log(`[3/10] Checking domain ages for ${allDomains.length} domains...`);
await attachDomainAges(opportunities, config);
const youngMin = config.youngDomainMinCount ?? 2;
for (const o of opportunities) {
  if ((o.youngDomainCount ?? 0) >= youngMin) {
    o.score = Math.min(o.score + (config.youngDomainBonus ?? 15), 100);
    o.signals.push(
      `${o.youngDomainCount} domains in top 10 are under 1 year old — new sites are breaking in`
    );
  }
}
opportunities.sort((a, b) => b.score - a.score);
const youngCount = opportunities.filter((o) => (o.youngDomainCount ?? 0) >= youngMin).length;
const ageKnown = opportunities.filter((o) => o.youngDomainCount !== undefined).length;
console.log(`  ${youngCount}/${opportunities.length} hit the ${youngMin}+ young-domain rule (${ageKnown} with age data)`);

// [4/10] Serper local cross-check — true country-targeted Google SERPs.
// Skips silently when SERPER_API_KEY is missing (free tier: 2,500/mo at serper.dev).
if (config.serper?.enabled !== false && process.env.SERPER_API_KEY) {
  console.log(`[4/10] Cross-checking ${opportunities.length} SERPs with Serper (local targeting)...`);
  const authMap = {};
  for (const o of opportunities) {
    for (const d of o.domainAuthority || []) authMap[d.domain] = d;
  }
  let checked = 0;
  for (const o of opportunities) {
    try {
      const check = await crossCheckSerp(o, authMap, config.lowAuthorityThreshold);
      o.serperCheck = check;
      if (check) {
        checked++;
        o.signals.push(
          `Serper local SERP (${check.gl}): ${check.weakCount}/${check.total} weak domains — ${check.note}`
        );
      }
    } catch (e) {
      console.error(`  Serper failed for ${o.program}: ${e.message}`);
      o.serperCheck = null;
    }
  }
  console.log(`  ${checked}/${opportunities.length} cross-checked`);
} else {
  console.log(`[4/10] Serper cross-check skipped (no SERPER_API_KEY — get 2,500 free/mo at serper.dev)`);
  for (const o of opportunities) o.serperCheck = null;
}

// [4b/10] Zero-click detection — SERP features that let Google answer the query
// itself (answer boxes, converter widgets, knowledge panels, video packs).
// Reuses the Serper payload from step 4 when available, otherwise falls back
// to Tavily-only heuristics. Applies a capped score penalty and flags the
// risk; never deletes an opportunity on its own.
if (config.zeroclick?.enabled !== false) {
  console.log(`[4b/10] Detecting zero-click SERP features for ${opportunities.length} opportunities...`);
  let withData = 0, high = 0;
  for (const o of opportunities) {
    const analysis = analyzeZeroClick({
      query: o.query,
      tavilyResults: o.topResults || [],
      serperFeatures: o.serperCheck?.features || null,
      penalties: config.zeroclick,
    });
    applyZeroClickPenalty(o, analysis, config.zeroclick);
    if (analysis.source !== 'none') withData++;
    if (analysis.risk === 'high') high++;
  }
  opportunities.sort((a, b) => b.score - a.score);
  console.log(`  ${withData}/${opportunities.length} with SERP-feature data; ${high} flagged HIGH zero-click risk`);
}

// [5/10] Volume check — KWscanner bulk lookup (saved session; skips gracefully if
// Playwright isn't installed or the session expired). Volume-failing keywords are
// NOT expanded, saving Tavily credits; they stay in the report for transparency.
console.log(`[5/10] Checking search volume for ${opportunities.length} keywords...`);
await attachVolumes(opportunities, config);
const volKnown = opportunities.filter((o) => o.volume && o.volume.value !== null).length;
const volPass = opportunities.filter((o) => o.volumePass === true).length;
console.log(`  ${volKnown}/${opportunities.length} volumes resolved; ${volPass} pass the ${config.kwscanner.volumeMin.toLocaleString()}/mo filter`);

// [6/10] Seasonality — Google Trends 12-month check for volume-passing (or
// volume-unknown) opportunities. Strongly seasonal keywords get flagged so a
// December spike doesn't get mistaken for evergreen demand.
const seasonalTargets = opportunities.filter((o) => o.volumePass !== false);
if (config.trends?.enabled !== false) {
  console.log(`[6/10] Checking seasonality for ${seasonalTargets.length} keywords...`);
  for (const [i, o] of seasonalTargets.entries()) {
    const { gl } = localeFor(o.country, o.language);
    o.seasonality = await checkSeasonality(o.program, (gl || '').toUpperCase(), config.trends?.months ?? 12);
    if ((i + 1) % 5 === 0) console.log(`  ...${i + 1}/${seasonalTargets.length}`);
  }
  const seasonal = seasonalTargets.filter((o) => o.seasonality?.label === 'strongly seasonal').length;
  console.log(`  ${seasonal} strongly seasonal (flagged in report)`);
}
for (const o of opportunities) {
  if (!('seasonality' in o)) o.seasonality = null;
}

// [7/10] Cluster expansion — only for volume-passing (or volume-unknown) opportunities
const toExpand = opportunities.filter((o) => o.volumePass !== false);
const skippedVol = opportunities.length - toExpand.length;
if (skippedVol) console.log(`[7/10] Skipping expansion for ${skippedVol} below-volume keywords`);
for (const [i, o] of toExpand.entries()) {
  console.log(`[7/10] Expanding cluster ${i + 1}/${toExpand.length}: ${o.program} (${o.country})`);
  o.cluster = await expandCluster(o.program);
  // Google Autocomplete long-tails (free, unscored — content-planning material)
  if (config.autocomplete?.enabled !== false) {
    const { hl, gl } = localeFor(o.country, o.language);
    o.longtails = await expandWithAutocomplete(o.program, { hl, gl });
    console.log(`  + ${o.longtails.length} autocomplete long-tails (unscored, hl=${hl}${gl ? `, gl=${gl}` : ''})`);
  } else {
    o.longtails = [];
  }
}
for (const o of opportunities) {
  if (!o.cluster) { o.cluster = []; o.signals.push('not expanded: below volume filter'); }
  if (!o.longtails) o.longtails = [];
}

// [8/10] Content-gap briefs — what a winning page must beat, for the top-N
// opportunities only (free fetches, cached per URL; blocked pages skipped).
if (config.contentgap?.enabled !== false) {
  const topN = [...toExpand]
    .sort((a, b) => b.score - a.score)
    .slice(0, config.contentgap?.topN ?? 5);
  for (const [i, o] of topN.entries()) {
    const urls = (o.topResults || []).map((r) => r.url).filter(Boolean);
    console.log(`[8/10] Content brief ${i + 1}/${topN.length}: ${o.program} (${urls.length} pages)`);
    o.contentBrief = await analyzeContent(o.program, urls, {});
    if (o.contentBrief) {
      console.log(`  ${o.contentBrief.verdict}`);
    } else {
      console.log(`  (no pages analyzable — all blocked)`);
    }
  }
}
for (const o of opportunities) {
  if (!o.contentBrief) o.contentBrief = null;
}

// [9/10] Report
const { dbFile, csvFile, mdFile, shortlistFile } = writeOutputs(opportunities, config.dataDir);

// [10/10] Re-run diff — what changed since the previous run (free; needs 2+ DBs)
const diffResult = diffWithPrevious(config.dataDir, opportunities, dbFile);
if (diffResult) {
  const { diff, mdFile: diffFile, prevStamp } = diffResult;
  console.log(`[10/10] Diff vs ${prevStamp}: +${diff.added.length} new, -${diff.removed.length} dropped, ${diff.scoreUp.length} up / ${diff.scoreDown.length} down ≥10pts, ${diff.volumeChanged.length} volume changes`);
  console.log(`  Diff:      ${diffFile}`);
} else {
  console.log(`[10/10] No previous run to diff against (first run)`);
}
console.log(`Done.`);
console.log(`  Report:    ${mdFile}`);
console.log(`  CSV:       ${csvFile}`);
console.log(`  Shortlist: ${shortlistFile}  <-- volume pre-filled from KWscanner; validate true DR in Ahrefs`);
console.log(`  DB:        ${dbFile}`);
console.log(`Fresh Tavily calls this run: ${freshCalls} (~${freshCalls} credits on basic).`);
