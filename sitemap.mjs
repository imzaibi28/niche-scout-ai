// Competitor sitemap miner — free, keyless, zero new dependencies.
//
// Reverse-engineers a ranking site's keyword pattern: fetches its sitemap(s),
// extracts every URL, and mines the URL structure for repeat templates like
//   /kode-pos/{city}   (312 pages)   or   /{year}/kalendarz-swiat
// This is the automated version of the manual tactic: "find a low-DR site
// ranking for utility queries, identify the keyword pattern feeding it traffic,
// then build ~20 similar-but-not-copied niches."
//
// Standalone recon tool (not a pipeline step — run it on demand against a
// weak domain you spotted in an opportunity's top-10):
//   node sitemap.mjs --domain example.pl [--limit 500] [--min-count 3]
//
// Handles: robots.txt Sitemap: discovery, sitemap indexes (recursed, capped),
// WordPress /wp-sitemap.xml, plain URL lists. Fails gracefully when a site
// blocks the fetch or has no sitemap.
import axios from 'axios';
import { pathToFileURL } from 'url';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const TIMEOUT = 20000;
const MAX_CHILD_SITEMAPS = 50;

async function fetchText(url) {
  const { data } = await axios.get(url, {
    timeout: TIMEOUT,
    headers: { 'User-Agent': UA, Accept: 'application/xml, text/xml, */*' },
    maxContentLength: 50 * 1024 * 1024,
    validateStatus: (s) => s === 200,
  });
  return typeof data === 'string' ? data : '';
}

const locsOf = (xml) => {
  const out = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) && out.length < 100000) out.push(m[1].trim());
  return out;
};
const isIndex = (xml) => /<sitemapindex[\s>]/i.test(xml);

export function normalizeDomain(input) {
  return input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

// Fetch every URL listed across a domain's sitemap(s). Returns string[].
export async function fetchSitemapUrls(domain, { limit = 500 } = {}) {
  domain = normalizeDomain(domain);
  const tried = [];
  const sitemapUrls = new Set();

  // 1. robots.txt discovery
  try {
    const robots = await fetchText(`https://${domain}/robots.txt`);
    for (const m of robots.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) sitemapUrls.add(m[1]);
  } catch { /* robots optional */ }

  // 2. conventional locations
  for (const p of ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']) {
    sitemapUrls.add(`https://${domain}${p}`);
  }

  const pageUrls = [];
  const seen = new Set();
  for (const smUrl of sitemapUrls) {
    if (pageUrls.length >= limit) break;
    let xml;
    try {
      xml = await fetchText(smUrl);
      tried.push(smUrl);
    } catch { continue; } // 404/blocked -> try next candidate
    if (!xml || !/<urlset[\s>]|<sitemapindex[\s>]/i.test(xml)) continue;

    if (isIndex(xml)) {
      const children = locsOf(xml).slice(0, MAX_CHILD_SITEMAPS);
      for (const child of children) {
        if (pageUrls.length >= limit) break;
        try {
          const cxml = await fetchText(child);
          if (!cxml || isIndex(cxml)) continue;
          for (const u of locsOf(cxml)) {
            if (!seen.has(u)) { seen.add(u); pageUrls.push(u); }
            if (pageUrls.length >= limit) break;
          }
        } catch { /* skip bad child */ }
      }
    } else {
      for (const u of locsOf(xml)) {
        if (!seen.has(u)) { seen.add(u); pageUrls.push(u); }
        if (pageUrls.length >= limit) break;
      }
    }
    if (pageUrls.length) break; // first working sitemap wins
  }

  if (!pageUrls.length) {
    throw new Error(`no usable sitemap found for ${domain} (tried: ${tried.join(', ') || 'none responded'})`);
  }
  return pageUrls;
}

// --- pattern mining ---
const YEAR_RE = /\b(19|20)\d{2}\b/g;

// Normalize one URL segment for pattern grouping.
// rollup=true additionally generalizes the alpha part of segments that
// contain numbers, so `jakarta-10000` and `bandung-20000` (city+zip fused
// slugs — a classic programmatic-SEO shape) group into one pattern.
function normalizeSegment(seg, rollup = false) {
  let s = seg.toLowerCase().replace(YEAR_RE, '{year}').replace(/\d+/g, '{n}');
  if (rollup && /\{(n|year)\}/.test(s)) {
    s = s.replace(/^[a-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u4e00-\u9fff]+/u, '{w}');
  }
  return s;
}

// url -> precise template + rolled-up shape (for grouping fused slugs)
function templateOf(url) {
  let path = '/';
  try { path = new URL(url).pathname; } catch { /* keep '/' */ }
  const raw = path.split('/').filter(Boolean);
  return {
    template: raw.map((s) => normalizeSegment(s, false)).join('/') || '(homepage)',
    shape: raw.map((s) => normalizeSegment(s, true)).join('/') || '(homepage)',
    precise: raw.map((s) => normalizeSegment(s, false)),
  };
}

export function slugToKeywords(url) {
  let path = '/';
  try { path = new URL(url).pathname; } catch { /* ignore */ }
  const segs = path.split('/').filter(Boolean);
  const last = segs[segs.length - 1] || '';
  return last
    .replace(/\.(html?|php|aspx?)$/i, '')
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Mine repeat URL templates. Returns top patterns with counts, examples,
// entity-slot detection (positions whose values vary = the {city}/{name} slot),
// and derived keyword phrases.
export function extractPatterns(urls, { minCount = 3, top = 15 } = {}) {
  const groups = new Map(); // shape -> { count, posValues: Set[], examples: string[], precise: Map }
  for (const u of urls) {
    const { shape, precise } = templateOf(u);
    if (shape === '(homepage)') continue;
    if (!groups.has(shape)) groups.set(shape, { count: 0, posValues: [], examples: [] });
    const g = groups.get(shape);
    g.count++;
    precise.forEach((s, i) => {
      g.posValues[i] = g.posValues[i] || new Set();
      if (g.posValues[i].size < 500) g.posValues[i].add(s);
    });
    if (g.examples.length < 3) g.examples.push(u);
  }

  const patterns = [];
  for (const [shape, g] of groups) {
    if (g.count < minCount) continue;
    // entity-slot detection: positions with many distinct precise values
    const slots = {};
    const displaySegs = shape.split('/');
    g.posValues.forEach((set, i) => {
      if (set.size >= 4 && set.size >= Math.max(2, g.count * 0.05)) {
        slots[i] = { distinct: set.size, samples: [...set].slice(0, 5) };
        displaySegs[i] = '{…}';
      }
    });
    patterns.push({
      pattern: '/' + displaySegs.join('/'),
      pages: g.count,
      entitySlots: slots,
      examples: g.examples,
      keywords: [...new Set(g.examples.map(slugToKeywords).filter(Boolean))].slice(0, 5),
    });
  }
  patterns.sort((a, b) => b.pages - a.pages);
  return patterns.slice(0, top);
}

export async function analyzeDomain(domain, opts = {}) {
  const urls = await fetchSitemapUrls(domain, opts);
  return {
    domain: normalizeDomain(domain),
    urlCount: urls.length,
    truncated: urls.length >= (opts.limit || 500),
    patterns: extractPatterns(urls, opts),
    fetchedAt: new Date().toISOString(),
  };
}

// ---- CLI ----
const isEntryPoint = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isEntryPoint) {
  const args = process.argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  };
  const domain = get('--domain');
  if (!domain) {
    console.log('Usage: node sitemap.mjs --domain example.pl [--limit 500] [--min-count 3]');
    process.exit(1);
  }
  const limit = parseInt(get('--limit', '500'), 10);
  const minCount = parseInt(get('--min-count', '3'), 10);
  console.log(`Mining sitemap for ${domain} (limit ${limit})...`);
  try {
    const report = await analyzeDomain(domain, { limit, minCount });
    console.log(`\n${report.urlCount} URLs indexed${report.truncated ? ' (capped)' : ''}. Top patterns:\n`);
    if (!report.patterns.length) console.log('  (no repeating URL pattern found — likely a flat blog, not a programmatic-SEO site)');
    report.patterns.forEach((p, i) => {
      console.log(`${i + 1}. ${p.pattern}  — ${p.pages} pages`);
      if (p.keywords.length) console.log(`   keywords: ${p.keywords.join(' | ')}`);
      for (const [pos, slot] of Object.entries(p.entitySlots)) {
        console.log(`   slot @ segment ${pos}: ${slot.distinct} distinct values (e.g. ${slot.samples.join(', ')})`);
      }
      console.log(`   e.g. ${p.examples[0]}`);
    });
    console.log('\nRead: each repeating pattern = a keyword cluster feeding this site traffic.');
    console.log('Build ~20 similar-but-not-copied niches by swapping the entity slot (city, name, year) or the utility verb.');
  } catch (e) {
    console.error(`Failed: ${e.message}`);
    process.exit(1);
  }
}
