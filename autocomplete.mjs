// Google Autocomplete seed expander — free, keyless, zero dependencies.
//
// Turns one seed keyword into real long-tail queries people actually type,
// using Google's public suggest endpoint (the same one behind the search box).
// Unlike the template-based expander (expander.mjs), these are observed
// queries, not guesses — much better raw material for cluster pages.
//
// Cost: $0, no API key, no credits. Politeness delay between calls.
// Output is UNSCORED (no Tavily spend): long-tails enrich the cluster for
// content planning; the template siblings keep their Tavily-scored checks.
//
// CLI:
//   node autocomplete.mjs --seed "sennik" --hl pl --gl pl --depth 2 --limit 40
//
// Used by run.mjs step [5/6]: each opportunity's program keyword is expanded
// into long-tails in its own locale (o.longtails).
import axios from 'axios';
import { pathToFileURL } from 'url';
import { cacheGet, cacheSet } from './cache.mjs';
import { sleep } from './util.mjs';
import { config } from './config.mjs';

const SUGGEST_URL = 'https://suggestqueries.google.com/complete/search';

// Country name -> Google gl (geolocation) code
const GL_BY_COUNTRY = {
  Indonesia: 'id', Malaysia: 'my', Thailand: 'th', Vietnam: 'vn',
  Nigeria: 'ng', Ghana: 'gh', Bangladesh: 'bd', Brazil: 'br', Mexico: 'mx',
  'South Africa': 'za', Germany: 'de', Poland: 'pl', Romania: 'ro',
  Czechia: 'cz', 'Czech Republic': 'cz', Spain: 'es', Argentina: 'ar',
  Colombia: 'co', Chile: 'cl', Peru: 'pe', Philippines: 'ph', India: 'in',
  Pakistan: 'pk', Turkey: 'tr', Ukraine: 'ua', Russia: 'ru', France: 'fr',
  Italy: 'it', Portugal: 'pt', Netherlands: 'nl', UK: 'gb', US: 'us',
  Canada: 'ca', Australia: 'au', Egypt: 'eg', 'Saudi Arabia': 'sa',
};

// Language name -> Google hl (interface language) code
const HL_BY_LANGUAGE = {
  Indonesian: 'id', Malay: 'ms', Thai: 'th', Vietnamese: 'vi', English: 'en',
  Bengali: 'bn', Portuguese: 'pt', Spanish: 'es', German: 'de', Polish: 'pl',
  Romanian: 'ro', Czech: 'cs', French: 'fr', Italian: 'it', Turkish: 'tr',
  Ukrainian: 'uk', Russian: 'ru', Dutch: 'nl', Filipino: 'tl', Tagalog: 'tl',
  Hindi: 'hi', Urdu: 'ur', Arabic: 'ar',
};

export function localeFor(country, language) {
  return {
    gl: GL_BY_COUNTRY[country] || undefined,
    hl: HL_BY_LANGUAGE[language] || 'en',
  };
}

const acConfig = () => config.autocomplete || {};
const delay = () => config.delayMs || 1200;

// One suggest call -> array of suggestion strings.
export async function fetchSuggestions(query, { hl = 'en', gl } = {}) {
  const params = { client: 'firefox', q: query, hl };
  if (gl) params.gl = gl;
  try {
    const { data } = await axios.get(SUGGEST_URL, {
      params,
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    const suggestions = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
    return suggestions.filter((s) => typeof s === 'string' && s.trim().length > 2);
  } catch {
    return []; // suggest endpoint hiccups are non-fatal
  }
}

const cacheKey = (query, hl, gl) => `ac::${hl}:${gl || '-'}:${query.toLowerCase()}`;

// Expand a keyword into deduped long-tails.
// depth 1: suggestions for the keyword.
// depth 2: suggestions of the top `fanout` depth-1 suggestions (capped).
export async function expandWithAutocomplete(keyword, { hl = 'en', gl, depth, fanout, limit } = {}) {
  const d = depth ?? acConfig().depth ?? 2;
  const f = fanout ?? acConfig().fanout ?? 6;
  const lim = limit ?? acConfig().limit ?? 40;

  const seen = new Set([keyword.toLowerCase()]);
  const out = [];
  const push = (s) => {
    const k = s.toLowerCase().trim();
    if (!seen.has(k) && k.length > 2) {
      seen.add(k);
      out.push(s.trim());
    }
  };

  const cachedGet = async (q) => {
    const ck = cacheKey(q, hl, gl);
    const hit = cacheGet(ck);
    if (hit) return hit.payload;
    await sleep(delay());
    const payload = await fetchSuggestions(q, { hl, gl });
    cacheSet(ck, payload);
    return payload;
  };

  const level1 = await cachedGet(keyword);
  level1.forEach(push);

  if (d >= 2) {
    for (const q of level1.slice(0, f)) {
      const level2 = await cachedGet(q);
      level2.forEach(push);
      if (out.length >= lim * 2) break; // early stop once we have plenty
    }
  }

  // Prefer longer, more specific queries first (better long-tail material)
  out.sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length || b.length - a.length);
  return out.slice(0, lim);
}

// ---- CLI ----
const isEntryPoint = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isEntryPoint) {
  const args = process.argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  };
  const seed = get('--seed');
  if (!seed) {
    console.log('Usage: node autocomplete.mjs --seed "sennik" [--hl pl] [--gl pl] [--depth 2] [--limit 40]');
    process.exit(1);
  }
  const hl = get('--hl', 'en');
  const gl = get('--gl');
  const depth = parseInt(get('--depth', '2'), 10);
  const limit = parseInt(get('--limit', '40'), 10);
  console.log(`Expanding "${seed}" (hl=${hl}${gl ? `, gl=${gl}` : ''}, depth=${depth})...`);
  const tails = await expandWithAutocomplete(seed, { hl, gl, depth, limit });
  console.log(`\n${tails.length} long-tail queries:`);
  tails.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
}
