// SERP weakness scorer — the brain of the agent. Heuristic, no AI needed.
// Higher score (0-100) = weaker competition = better opportunity.
import { existsSync, readFileSync } from 'fs';
import { domainOf } from './util.mjs';

const SOCIAL_DOMAINS = [
  'reddit.com', 'quora.com', 'tiktok.com', 'youtube.com', 'youtu.be',
  'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'pinterest.com',
];
const THIN_HOSTS = [
  'blogspot.', 'wixsite.com', 'wordpress.com', 'weebly.com',
  'jimdofree.com', 'webnode.com', 'blogger.com',
];
const NEWS_HINTS = ['news', 'tribune', 'herald', 'daily', 'times', 'channel', 'reporter', '.post'];

const isSocial = (d) => SOCIAL_DOMAINS.some((s) => d.includes(s));
const isThin = (d) => THIN_HOSTS.some((t) => d.includes(t));
const looksNews = (d) => NEWS_HINTS.some((n) => d.includes(n));

export function scoreSerp(query, results = []) {
  const signals = [];
  let score = 0;
  if (!results.length) return { score: 0, signals: ['no results returned'] };

  const top5 = results.slice(0, 5);
  const top10 = results.slice(0, 10);

  // 1. Forum/social in top 5 → real sites aren't serving the intent (+20..35)
  const socialHits = top5.filter((r) => isSocial(domainOf(r.url)));
  if (socialHits.length > 0) {
    score += 20 + 5 * Math.min(socialHits.length - 1, 3);
    signals.push(
      `${socialHits.length}/${top5.length} top results are forums/social — dedicated sites aren't serving this intent`
    );
  }

  // 2. Stale results → freshness gap (+0..20)
  const dates = results
    .map((r) => r.published_date)
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => !Number.isNaN(t));
  if (dates.length > 0) {
    const avgAgeDays = dates.reduce((a, t) => a + (Date.now() - t), 0) / dates.length / 86400000;
    const yrs = Math.round((avgAgeDays / 365) * 10) / 10;
    if (avgAgeDays > 730) {
      score += 20;
      signals.push(`average result age ${yrs} years — stale SERP`);
    } else if (avgAgeDays > 365) {
      score += 10;
      signals.push(`average result age ${yrs} years — aging SERP`);
    }
  } else {
    score += 5;
    signals.push('no publish dates on results — weak page metadata');
  }

  // 3. Thin/personal domains ranking → low authority bar (+0..20)
  const thinHits = top10.filter((r) => isThin(domainOf(r.url)));
  if (thinHits.length > 0) {
    score += Math.min(10 + 5 * thinHits.length, 20);
    signals.push(
      `${thinHits.length} thin/personal domains (blogspot/wix/etc.) in top 10 — low authority bar`
    );
  }

  // 4. One-domain monopoly → contestable (+15)
  const counts = {};
  for (const r of top10) {
    const d = domainOf(r.url);
    counts[d] = (counts[d] || 0) + 1;
  }
  const mono = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (mono && mono[1] >= 3 && !isSocial(mono[0])) {
    score += 15;
    signals.push(`one small domain (${mono[0]}) holds ${mono[1]} top-10 spots — a monopoly you can contest`);
  }

  // 5. Official results are PDFs or login walls → how-to intent underserved (+10)
  const gated = top10.filter(
    (r) => /\.pdf($|\?)/i.test(r.url) || /login|sign-?in/i.test(r.url + ' ' + (r.title || ''))
  );
  if (gated.length > 0) {
    score += 10;
    signals.push(`${gated.length} top results are PDFs/login-gated — how-to intent underserved`);
  }

  // 6. News-dominated SERP, no evergreen guide (+10)
  const newsHits = top10.filter((r) => looksNews(domainOf(r.url)));
  if (newsHits.length >= 4) {
    score += 10;
    signals.push(`${newsHits.length}/10 results are news sites — no evergreen guide owns this query`);
  }

  return { score: Math.min(Math.round(score), 100), signals };
}

// Signal families — the learnable units. learn.mjs correlates these against
// your logged outcomes; applyLearnedAdjustments then re-weights future scores.
export const SIGNAL_FAMILIES = [
  { id: 'forum_social',   label: 'forum/social in top results',   test: (s) => /forums\/social|dedicated sites aren't serving/i.test(s) },
  { id: 'stale_serp',     label: 'stale/aging SERP',              test: (s) => /stale SERP|aging SERP/i.test(s) },
  { id: 'thin_domains',   label: 'thin/personal domains ranking', test: (s) => /thin\/personal domains/i.test(s) },
  { id: 'monopoly',       label: 'one-domain monopoly',           test: (s) => /monopoly/i.test(s) },
  { id: 'gated',          label: 'PDFs/login-gated results',      test: (s) => /PDFs\/login-gated|how-to intent underserved/i.test(s) },
  { id: 'news_dominated', label: 'news-dominated SERP',           test: (s) => /news sites/i.test(s) },
  { id: 'authority_bonus', label: '3+ weak domains (authority)',   test: (s) => /very low authority|weak-domain rule/i.test(s) },
  { id: 'young_domains',   label: 'young domains ranking',       test: (s) => /under 1 year old|new sites are breaking in/i.test(s) },
  { id: 'serper_local',   label: 'Serper local cross-check',      test: (s) => /Serper local SERP/i.test(s) },
  { id: 'zero_click',     label: 'zero-click SERP features',      test: (s) => /zero-click/i.test(s) },
];

export function familiesIn(signals = []) {
  return SIGNAL_FAMILIES.filter((f) => signals.some((s) => f.test(s)));
}

// The learning loop, applied: reads data/learned-adjustments.json (written by
// learn.mjs) and re-weights the score. Never throws — returns the input
// unchanged when there's nothing learned yet.
export function applyLearnedAdjustments({ score, signals }, dataDir = './data') {
  const f = `${dataDir}/learned-adjustments.json`;
  let learned = null;
  try {
    if (existsSync(f)) learned = JSON.parse(readFileSync(f, 'utf8'));
  } catch { /* corrupt file = ignore, keep going */ }
  if (!learned?.families) return { score, signals };

  const out = { score, signals: [...signals] };
  for (const fam of familiesIn(signals)) {
    const adj = learned.families[fam.id]?.adjustment;
    if (!adj) continue;
    out.score = Math.max(0, Math.min(100, out.score + adj));
    const kind = adj > 0 ? 'bonus' : 'penalty';
    out.signals.push(
      `learned ${kind} ${adj > 0 ? '+' : ''}${adj}: "${fam.label}" won ${learned.families[fam.id].winRate}% of ${learned.families[fam.id].samples} past tests`
    );
  }
  return out;
}

// Optional upgrade: plug your Cheerio crawler in here to fill missing
// published_date values by fetching result pages and reading
// meta[property="article:published_time"], <time datetime>, or JSON-LD
// datePublished. Tavily's dates are enough to start — add this later.
export async function enrichDates(results, fetchHtml) {
  return results;
}
