// Serper API — country-targeted Google SERP cross-check (fixes Tavily's US bias).
// Serper is a paid API (2,500 free searches/month at serper.dev, then ~$50/1k).
// Without SERPER_API_KEY in .env this module skips gracefully — nothing breaks.
// Usage: node serper.mjs --query "sennik" --gl pl --hl pl
import axios from 'axios';
import { cacheGet, cacheSet } from './cache.mjs';
import { localeFor } from './autocomplete.mjs';
import { normalizeSerperFeatures } from './serpfeatures.mjs';
import { sleep, domainOf } from './util.mjs';

const SERPER_URL = 'https://google.serper.dev/search';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function apiKey() {
  return process.env.SERPER_API_KEY || '';
}

function rawCacheKey(query, gl) {
  return `serperraw::${(gl || '').toLowerCase()}::${query.toLowerCase()}`;
}

// Full Serper payload: organic results + SERP features (answerBox,
// knowledgeGraph, peopleAlsoAsk) used for zero-click detection.
// Returns null when the key is missing (graceful skip), throws on API errors
// (caller decides). Cached per query+gl; only the fields the agent needs are
// stored to keep the cache small.
export async function searchSerperRaw(query, { gl = '', hl = 'en', num = 10 } = {}) {
  const key = apiKey();
  if (!key) return null;

  const ck = rawCacheKey(query, gl);
  const hit = cacheGet(ck);
  if (hit) return hit.payload;

  await sleep(600);
  const res = await axios.post(
    SERPER_URL,
    { q: query, gl, hl, num, autocorrect: false },
    { headers: { 'X-API-KEY': key, 'Content-Type': 'application/json', 'User-Agent': UA }, timeout: 30000 }
  );
  const data = res.data || {};
  const payload = {
    organic: (data.organic || []).map((r) => ({ title: r.title || '', link: r.link || '' })),
    features: normalizeSerperFeatures(data),
  };
  cacheSet(ck, payload);
  return payload;
}

// Raw Serper search → organic results [{title, link}]. Returns null when the
// key is missing (graceful skip), throws on API errors (caller decides).
export async function searchSerper(query, opts = {}) {
  const raw = await searchSerperRaw(query, opts);
  return raw ? raw.organic : null;
}

// Cross-check one opportunity: fetch the LOCAL Serper SERP for its query and
// count how many of its domains look weak using the already-fetched OPR map.
// authority: Map/object from authority.mjs keyed by domain → {opr}.
// Returns null when Serper is unavailable; otherwise
// { gl, domains, total, weakCount, note, features } — features is the
// normalized SERP-feature set for zero-click detection (serpfeatures.mjs).
export async function crossCheckSerp(opportunity, authority, lowThreshold = 2.0) {
  const { hl, gl } = localeFor(opportunity.country, opportunity.language);
  const raw = await searchSerperRaw(opportunity.query, { gl, hl });
  if (!raw) return null;
  const results = raw.organic;

  const domains = [...new Set(results.map((r) => domainOf(r.link)).filter(Boolean))].slice(0, 10);
  let weakCount = 0;
  const scored = domains.map((d) => {
    const entry = authority?.[d];
    const opr = entry?.opr ?? null;
    const weak = opr !== null && opr <= lowThreshold;
    if (weak) weakCount++;
    return { domain: d, opr, weak };
  });
  const note =
    weakCount >= 3
      ? 'local SERP confirms a weak field'
      : weakCount >= (opportunity.lowAuthorityCount ?? 0)
        ? 'local SERP roughly matches Tavily'
        : 'local SERP looks STRONGER than Tavily — verify by hand before building';
  return { gl, domains: scored, total: domains.length, weakCount, note, features: raw.features };
}

function arg(name, def = '') {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

if (process.argv[1]?.endsWith('serper.mjs')) {
  const query = arg('--query');
  if (!query) {
    console.log('Usage: node serper.mjs --query "sennik" --gl pl --hl pl');
    console.log('(Needs SERPER_API_KEY in .env — 2,500 free searches/month at serper.dev)');
    process.exit(1);
  }
  searchSerper(query, { gl: arg('--gl', 'pl'), hl: arg('--hl', 'pl') })
    .then((results) => {
      if (!results) {
        console.log('Serper skipped: no SERPER_API_KEY in .env (this is fine — the pipeline works without it).');
        return;
      }
      console.log(`Serper returned ${results.length} organic results for "${query}":`);
      results.forEach((r, i) => console.log(` ${i + 1}. ${r.title}\n    ${r.link}`));
    })
    .catch((e) => console.error('Serper error:', e.response?.data?.message || e.message));
}
