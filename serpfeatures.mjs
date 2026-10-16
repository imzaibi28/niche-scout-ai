// Zero-click / SERP-feature detection.
//
// A keyword can pass every competition filter and still be worthless when
// Google answers the query itself: answer boxes / featured snippets, currency
// and unit converter widgets, knowledge panels, or a video pack. This module
// scores that risk from SERP features — no extra API calls, it reuses the
// Serper payload fetched in step 4 plus the Tavily top results from step 1.
//
// Risk levels: high (penalty >= 20), medium (>= 10), low (> 0),
// minimal (data present, nothing observed), unknown (no data).
// Penalties are negative adjustments, capped at maxPenalty (default 30).
// This is a penalty + flag, NOT a hard gate: heavy zero-click keywords sink
// in the ranking and get flagged in the report, but nothing is auto-deleted.
//
// Usage: node serpfeatures.mjs --query "precio del dolar hoy" --gl mx --hl es
//   (needs SERPER_API_KEY — same key as the step-4 cross-check)
import { domainOf } from './util.mjs';

const DEFAULTS = {
  answerBox: 12,      // featured snippet / answer box present
  converter: 20,      // live converter/calculator widget (clicks get eaten)
  knowledgePanel: 8,  // knowledge panel (brand/entity intent)
  videoHeavy: 8,      // video pack answers the intent
  googleOwnedTop3: 5, // google/youtube in top 3 (self-preferencing)
  maxPenalty: 30,     // cap on the total zero-click penalty
};

// Query patterns where Google typically renders a live widget instead of
// links (currency, units, time). Matched against the query only when an
// answer box is actually present — a widget nobody sees costs nothing.
const CONVERTER_QUERY_RE =
  /\b(convert|converter|conversion|currency|exchange|kurs|przelicznik|conversor|convers[aã]o|cotac[aã]o|dolar hoy|dollar (rate|today|price)|precio del d[oó]lar|usd\s?to|to\s?usd|eur\s?to|to\s?eur)\b/i;

// Answer-box titles shaped like a computed result: "1 US Dollar = 17.42 ...".
const CONVERTER_TITLE_RE = /=\s*[\d.,]+\s*\S/;

const isGoogleOwned = (d) =>
  /(^|\.)google\./.test(d) || d === 'youtube.com' || d.endsWith('.youtube.com') || d === 'youtu.be';

const isVideo = (d) =>
  ['youtube.com', 'youtu.be', 'tiktok.com', 'vimeo.com', 'dailymotion.com'].some(
    (v) => d === v || d.endsWith('.' + v)
  );

// Normalize a raw Serper response into the small feature set this module
// needs. Null-safe: returns null when there is no usable payload.
export function normalizeSerperFeatures(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ab = raw.answerBox || null;
  const kg = raw.knowledgeGraph || null;
  return {
    hasAnswerBox: !!ab,
    answerBoxTitle: ab?.title || '',
    answerBoxSnippet: ab?.snippet || ab?.answer || '',
    hasKnowledgeGraph: !!kg,
    knowledgeGraphTitle: kg?.title || '',
    peopleAlsoAskCount: Array.isArray(raw.peopleAlsoAsk) ? raw.peopleAlsoAsk.length : 0,
  };
}

// Main entry: analyze one keyword's SERP for zero-click risk.
// serperFeatures: output of normalizeSerperFeatures (or null when Serper
// didn't run — Tavily-only heuristics still apply).
export function analyzeZeroClick({ query = '', tavilyResults = [], serperFeatures = null, penalties = {} } = {}) {
  const P = { ...DEFAULTS, ...penalties };
  const reasons = [];
  const features = {};
  let penalty = 0;
  let source = 'none';

  const top10 = (tavilyResults || []).slice(0, 10);
  const domains = top10.map((r) => domainOf(r.url || r.link || '')).filter(Boolean);

  if (serperFeatures) {
    source = 'serper+tavily';
    features.answerBox = !!serperFeatures.hasAnswerBox;
    features.knowledgePanel = !!serperFeatures.hasKnowledgeGraph;
    features.peopleAlsoAsk = serperFeatures.peopleAlsoAskCount || 0;

    if (serperFeatures.hasAnswerBox) {
      const boxText = `${serperFeatures.answerBoxTitle} ${serperFeatures.answerBoxSnippet}`.trim();
      const looksConverter = CONVERTER_TITLE_RE.test(boxText) || CONVERTER_QUERY_RE.test(query);
      features.converterWidget = looksConverter;
      if (looksConverter) {
        penalty += P.converter;
        reasons.push('Google answers this directly with a converter/calculator widget — clicks get eaten');
      } else {
        penalty += P.answerBox;
        reasons.push('Google shows an answer box / featured snippet — zero-click risk');
      }
    }
    if (serperFeatures.hasKnowledgeGraph) {
      penalty += P.knowledgePanel;
      reasons.push(
        `knowledge panel present${serperFeatures.knowledgeGraphTitle ? ` ("${serperFeatures.knowledgeGraphTitle}")` : ''} — entity intent, Google keeps the click`
      );
    }
  } else if (top10.length) {
    source = 'tavily-only';
  }

  // Tavily-visible heuristics (work with or without Serper).
  if (domains.length) {
    if (domains.slice(0, 3).some(isGoogleOwned)) {
      penalty += P.googleOwnedTop3;
      reasons.push('Google-owned result (google/youtube) in top 3 — self-preferencing eats clicks');
    }
    const videoCount = domains.filter(isVideo).length;
    const videoTop5 = domains.slice(0, 5).filter(isVideo).length;
    if (videoCount >= 3 || videoTop5 >= 2) {
      penalty += P.videoHeavy;
      reasons.push(`${videoCount} video result${videoCount === 1 ? '' : 's'} in top 10 — video answers the intent`);
    }
  }

  penalty = Math.min(penalty, P.maxPenalty);
  const risk =
    penalty >= 20 ? 'high' : penalty >= 10 ? 'medium' : penalty > 0 ? 'low'
    : source === 'none' ? 'unknown' : 'minimal';

  return {
    risk,
    penalty,
    reasons,
    features,
    source,
    note:
      risk === 'unknown'
        ? 'no SERP data to judge zero-click risk'
        : risk === 'minimal'
          ? 'no answer box, knowledge panel, converter widget, or video pack observed'
          : undefined,
  };
}

// Apply the analysis to a pipeline opportunity: stores o.zeroClick, subtracts
// the (capped) penalty from the score, and pushes a learnable signal.
// Returns the penalty applied.
export function applyZeroClickPenalty(opportunity, analysis, cfg = {}) {
  const maxPenalty = cfg.maxPenalty ?? DEFAULTS.maxPenalty;
  const penalty = Math.min(analysis.penalty, maxPenalty);
  opportunity.zeroClick = { ...analysis, penalty };
  if (penalty > 0) {
    opportunity.score = Math.max(0, opportunity.score - penalty);
    opportunity.signals.push(`zero-click risk ${analysis.risk}: ${analysis.reasons.join('; ')} (−${penalty} pts)`);
  } else {
    opportunity.signals.push(`zero-click check: ${analysis.risk}${analysis.note ? ` — ${analysis.note}` : ''}`);
  }
  return penalty;
}

function arg(name, def = '') {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

if (process.argv[1]?.endsWith('serpfeatures.mjs')) {
  const query = arg('--query');
  if (!query) {
    console.log('Usage: node serpfeatures.mjs --query "precio del dolar hoy" --gl mx --hl es');
    console.log('(Needs SERPER_API_KEY in .env — same key as the step-4 cross-check.)');
    process.exit(1);
  }
  const { searchSerperRaw } = await import('./serper.mjs');
  const raw = await searchSerperRaw(query, { gl: arg('--gl', ''), hl: arg('--hl', 'en') });
  if (!raw) {
    console.log('Serper skipped: no SERPER_API_KEY in .env (zero-click check needs it).');
    process.exit(0);
  }
  const analysis = analyzeZeroClick({ query, tavilyResults: raw.organic, serperFeatures: raw.features });
  console.log(`Query: ${query}`);
  console.log(`Zero-click risk: ${analysis.risk}${analysis.penalty ? ` (−${analysis.penalty} pts)` : ''}`);
  if (analysis.reasons.length) analysis.reasons.forEach((r) => console.log(`  - ${r}`));
  else console.log(`  ${analysis.note}`);
  console.log(`Features seen: ${JSON.stringify(analysis.features)} (source: ${analysis.source})`);
}
