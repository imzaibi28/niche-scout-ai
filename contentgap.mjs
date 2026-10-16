// Content-gap analyzer — free, keyless, zero new dependencies.
//
// For each opportunity, fetches the top-ranking pages and extracts what a
// winning page must beat: word count, heading structure, subtopics covered,
// and content freshness. Output is a writing brief, not a score.
//
// Why: the agent finds weak SERPs, but "weak" doesn't say what to publish.
// If the top 5 pages average 2,400 words, cover 6 shared subtopics, and the
// freshest is 18 months old, the brief writes itself.
//
// Cost: $0 — plain HTTP fetches, cached per URL (re-runs are free).
// JS-heavy or blocking pages are skipped gracefully and reported as such.
//
// CLI:
//   node contentgap.mjs --keyword "sennik" --urls "https://a.pl/1,https://b.pl/2"
//
// Used by run.mjs: top-N opportunities (config.contentgap.topN) get a brief
// from their top-M result pages (config.contentgap.maxPages).
import axios from 'axios';
import { pathToFileURL } from 'url';
import { cacheGet, cacheSet } from './cache.mjs';
import { sleep } from './util.mjs';
import { config } from './config.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const TIMEOUT = 20000;
const MAX_HTML = 3 * 1024 * 1024;

const stripTags = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const innerText = (html) => stripTags(html);

function metaContent(html, attr, value) {
  const m = html.match(new RegExp(`<meta[^>]+${attr}=["']${value}["'][^>]*>`, 'i'));
  if (!m) return null;
  const c = m[0].match(/content=["']([^"']+)["']/i);
  return c ? c[1] : null;
}

// Fetch + parse one page. Returns null on failure (blocked/JS-only/timeout).
export async function fetchPageStats(url) {
  const ck = `cg::${url}`;
  const hit = cacheGet(ck);
  if (hit) return hit.payload;

  await sleep(config.delayMs || 1200);
  let html;
  try {
    const { data } = await axios.get(url, {
      timeout: TIMEOUT,
      maxContentLength: MAX_HTML,
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      validateStatus: (s) => s === 200,
    });
    html = typeof data === 'string' ? data : '';
    if (!html || html.length < 500) return null;
  } catch {
    return null;
  }

  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim().slice(0, 200);
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => innerText(m[1])).filter(Boolean).slice(0, 3);
  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => innerText(m[1])).filter(Boolean).slice(0, 20);

  // main content area if identifiable, else whole body
  const article = html.match(/<article[\s\S]*?<\/article>/i)?.[0]
    || html.match(/<main[\s\S]*?<\/main>/i)?.[0]
    || html.match(/<body[\s\S]*?<\/body>/i)?.[0]
    || html;
  const words = stripTags(article).split(/\s+/).filter(Boolean).length;

  const published =
    metaContent(html, 'property', 'article:published_time')
    || metaContent(html, 'name', 'date')
    || html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1]
    || (html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] ?? null);

  const stats = {
    url,
    title: title || null,
    h1: h1s[0] || null,
    h2s,
    words,
    published: published ? published.slice(0, 10) : null,
  };
  cacheSet(ck, stats);
  return stats;
}

const median = (nums) => {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

// Analyze a set of ranking page URLs -> content brief.
export async function analyzeContent(keyword, urls, { maxPages } = {}) {
  const n = maxPages ?? config.contentgap?.maxPages ?? 5;
  const pages = [];
  for (const url of urls.slice(0, n)) {
    const stats = await fetchPageStats(url);
    if (stats && stats.words > 50) pages.push(stats); // ignore nav-only/failed fetches
  }
  if (!pages.length) return null;

  const wordCounts = pages.map((p) => p.words);

  // Must-cover subtopics: content words (3+ letters) appearing in the H2s of
  // 2+ competing pages, excluding the seed keyword's own tokens. Word-level
  // matching (not exact headings) because rivals phrase the same subtopic
  // differently ("Sennik zęby - znaczenie" vs "Zęby wypadające sennik").
  const kwTokens = new Set(keyword.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length > 2));
  const wordPages = new Map(); // word -> { pages: Set, examples: [] }
  pages.forEach((p, pi) => {
    for (const h of p.h2s) {
      const words = new Set((h.toLowerCase().match(/[\p{L}]{3,}/gu) || []).filter((w) => !kwTokens.has(w)));
      for (const w of words) {
        if (!wordPages.has(w)) wordPages.set(w, { pages: new Set(), examples: [] });
        const e = wordPages.get(w);
        e.pages.add(pi);
        if (e.examples.length < 2 && !e.examples.includes(h)) e.examples.push(h);
      }
    }
  });
  const themes = [...wordPages.entries()]
    .filter(([, e]) => e.pages.size >= 2)
    .sort((a, b) => b[1].pages.size - a[1].pages.size || b[1].examples[0].length - a[1].examples[0].length)
    .slice(0, 8)
    .map(([t, e]) => ({ topic: t, pages: e.pages.size, examples: e.examples }));

  const dates = pages.map((p) => p.published).filter(Boolean).sort();
  const brief = {
    keyword,
    pagesAnalyzed: pages.length,
    pagesAttempted: Math.min(urls.length, n),
    medianWords: median(wordCounts),
    minWords: Math.min(...wordCounts),
    maxWords: Math.max(...wordCounts),
    mustCoverTopics: themes,
    newestPublished: dates[dates.length - 1] || null,
    oldestPublished: dates[0] || null,
    titles: pages.map((p) => p.title).filter(Boolean).slice(0, 5),
  };
  // Plain-language verdict
  const parts = [`target ~${brief.medianWords.toLocaleString()} words (range ${brief.minWords.toLocaleString()}–${brief.maxWords.toLocaleString()})`];
  if (themes.length) parts.push(`cover: ${themes.map((t) => t.topic).join('; ')}`);
  if (brief.newestPublished) parts.push(`be fresher than ${brief.newestPublished} (newest competitor)`);
  brief.verdict = parts.join('. ') + '.';
  return brief;
}

// ---- CLI ----
const isEntryPoint = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isEntryPoint) {
  const args = process.argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  };
  const keyword = get('--keyword', 'query');
  const urls = (get('--urls', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!urls.length) {
    console.log('Usage: node contentgap.mjs --keyword "sennik" --urls "https://a.pl/1,https://b.pl/2"');
    process.exit(1);
  }
  console.log(`Analyzing ${urls.length} pages for "${keyword}"...`);
  const brief = await analyzeContent(keyword, urls, {});
  if (!brief) {
    console.log('No pages could be analyzed (all blocked or failed).');
    process.exit(1);
  }
  console.log(`\nBrief for "${brief.keyword}" (${brief.pagesAnalyzed}/${brief.pagesAttempted} pages analyzed):`);
  console.log(`  ${brief.verdict}`);
  if (brief.mustCoverTopics.length) {
    console.log('  Must-cover subtopics:');
    brief.mustCoverTopics.forEach((t) => console.log(`    - ${t.topic} (${t.pages}/${brief.pagesAnalyzed} pages)`));
  }
}
