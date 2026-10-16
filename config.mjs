// Shared settings. .env is loaded manually — no extra dependencies.
import { existsSync, readFileSync } from 'fs';

function loadEnv() {
  const f = './.env';
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv();

export const config = {
  tavilyApiKey: process.env.TAVILY_API_KEY || '',
  openpagerankKey: process.env.OPENPAGERANK_API_KEY || '',
  searchDepth: 'basic',   // 'basic' = 1 credit, 'advanced' = 2 credits per search
  maxResults: 10,
  delayMs: 1200,          // politeness delay between API calls (rate-limit safety)
  dataDir: './data',
  scoreThreshold: 45,     // SERPs scoring at/above this become opportunities
  maxOpportunities: 20,   // cap on reported opportunities per run
  // DR<20 proxy rule (OpenPageRank 0-10 scale — not true Ahrefs DR)
  lowAuthorityThreshold: 2.0, // domains at/below this count as "weak"
  lowAuthorityMinCount: 3,    // need this many weak domains in top 10
  authorityBonus: 30,         // score bonus when the rule hits
  // Fresh-domain rule: new sites breaking into the top 10 is the strongest
  // "anyone can enter" signal. Ages come from KWscanner's free Domain Age
  // Checker (cached per domain); unknown ages simply don't count as young.
  youngDomainMinCount: 2,    // need this many <1yr-old domains in top 10
  youngDomainMaxAgeDays: 365,
  youngDomainBonus: 15,      // score bonus when the rule hits
  // KWscanner volume step (Playwright automation, saved session — no password stored).
  // Country DBs available: global/us/uk/ca/au/in/nz/za (no PL/BR/RO/etc — use global).
  kwscanner: {
    enabled: true,     // false = skip the volume step entirely
    country: 'global', // volume market for all keywords
    volumeMin: 50000,   // hard filter: monthly searches needed to PASS
    headless: true,    // false for debugging (KWSCANNER_DEBUG=1 also forces visible)
    batchSize: 500,    // keywords per bulk paste (KWscanner allows up to 3000)
  },
  // Google Autocomplete long-tail expansion (free, keyless — no credits spent).
  // Runs per opportunity after cluster expansion; long-tails are UNSCORED
  // (content-planning material, not Tavily-searched).
  autocomplete: {
    enabled: true, // false = skip the long-tail step
    depth: 2,      // 1 = suggestions only; 2 = suggestions of top `fanout` suggestions
    fanout: 6,     // how many depth-1 queries to expand at depth 2
    limit: 40,     // max long-tails kept per opportunity
  },
  // Content-gap briefs (free, keyless — plain HTTP fetches, cached per URL).
  // Fetches the top-ranking pages for the best opportunities and derives
  // what a winning page must beat: word count, must-cover subtopics, freshness.
  contentgap: {
    enabled: true, // false = skip the content-gap step
    topN: 5,       // briefs for the top-N opportunities by score only
    maxPages: 5,   // pages analyzed per opportunity
  },
  // Serper local SERP cross-check (paid API — 2,500 free searches/month at
  // serper.dev). Re-fetches each opportunity's SERP with true country
  // targeting (gl/hl), fixing Tavily's US bias. Skips automatically when
  // SERPER_API_KEY is missing — the pipeline works fine without it.
  serper: {
    enabled: true, // false = skip the cross-check even if a key is present
  },
  // Zero-click / SERP-feature detection (serpfeatures.mjs). Flags keywords
  // where Google answers the query itself (answer boxes, converter widgets,
  // knowledge panels, video packs) — those can pass every competition filter
  // and still earn no clicks. Applied as a capped score penalty + risk flag,
  // not a hard gate. Reuses the step-4 Serper payload (no extra API cost);
  // falls back to Tavily-only heuristics when no SERPER_API_KEY is set.
  zeroclick: {
    enabled: true, // false = skip the zero-click step
    maxPenalty: 30,       // cap on the total zero-click penalty
    answerBox: 12,        // featured snippet / answer box present
    converter: 20,        // live converter/calculator widget (clicks get eaten)
    knowledgePanel: 8,    // knowledge panel (entity intent)
    videoHeavy: 8,        // video pack answers the intent
    googleOwnedTop3: 5,    // google/youtube in top 3 (self-preferencing)
  },
  // Google Trends seasonality check (free, keyless — unofficial endpoints).
  // Flags strongly seasonal keywords (e.g. "calendar 2026" December spikes)
  // so you don't build an evergreen site on a seasonal spike. Skips
  // gracefully when Trends rate-limits (common); those get 'unknown'.
  trends: {
    enabled: true, // false = skip the seasonality step
    months: 12,    // lookback window for the seasonality judgment
  },
};
