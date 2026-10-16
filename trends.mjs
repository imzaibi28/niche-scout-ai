// Google Trends seasonality check — free, keyless (unofficial API endpoints).
// Answers: is this keyword evergreen, or a December spike you'll regret building on?
// Usage: node trends.mjs --keyword "sennik" --geo PL
import axios from 'axios';
import { cacheGet, cacheSet } from './cache.mjs';
import { sleep } from './util.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TRENDS = 'https://trends.google.com/trends/api';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function stripJsonp(text) {
  return JSON.parse(text.replace(/^\)\]\}',?\s*/, ''));
}

async function get(path, params) {
  await sleep(800); // Trends rate-limits aggressively; be polite
  const res = await axios.get(`${TRENDS}${path}`, {
    params,
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    timeout: 30000,
  });
  return stripJsonp(res.data);
}

// Fetch weekly interest-over-time for a keyword in a country geo ('PL', 'BR'...).
// Returns [{time, value}] or null when Trends won't cooperate.
export async function getInterest(keyword, geo = '', months = 12) {
  const time = `today ${months}-m`;
  try {
    const explore = await get('/explore', {
      hl: 'en-US',
      tz: '-300',
      req: JSON.stringify({ comparisonItem: [{ keyword, geo, time }], category: 0, property: '' }),
    });
    const widget = (explore.widgets || []).find((w) => w.id === 'TIMESERIES');
    if (!widget?.token) return null;

    const data = await get('/widgetdata/multiline', {
      hl: 'en-US',
      tz: '-300',
      req: JSON.stringify({
        time,
        resolution: 'WEEK',
        locale: 'en-US',
        comparisonItem: [
          { geo, complexKeywordsRestriction: { keyword: [{ type: 'BROAD', value: keyword }] } },
        ],
        requestOptions: { property: '', resolution: 'WEEK', displayMode: '' },
      }),
      token: widget.token,
    });
    const series = data?.default?.timelineData || [];
    return series.map((p) => ({ time: Number(p.time) * 1000, value: p.value?.[0] ?? 0 }));
  } catch {
    return null; // rate-limited, blocked, or malformed — caller treats as unknown
  }
}

// Pure: collapse weekly points into monthly averages and judge the swing.
// Exported for testing. Returns { label, peakMonth, troughMonth, ratio, note }.
export function judgeSeasonality(series, geo = '') {
  const buckets = {};
  for (const p of series) {
    const d = new Date(p.time);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    (buckets[k] = buckets[k] || []).push(p.value);
  }
  const monthly = Object.entries(buckets).map(([k, vals]) => ({
    month: k,
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
  }));
  if (monthly.length < 6) return null;
  const peak = monthly.reduce((a, b) => (b.avg > a.avg ? b : a));
  const trough = monthly.reduce((a, b) => (b.avg < a.avg ? b : a));
  const ratio = trough.avg > 0 ? peak.avg / trough.avg : peak.avg > 0 ? 99 : 1;
  const fmt = (k) => {
    const [y, m] = k.split('-');
    return `${MONTHS[Number(m) - 1]} ${y}`;
  };
  const label =
    ratio >= 3 ? 'strongly seasonal' : ratio >= 1.8 ? 'mildly seasonal' : 'evergreen';
  const warn =
    label === 'strongly seasonal'
      ? ' — build only if you accept the off-season traffic cliff'
      : label === 'mildly seasonal'
        ? ' — plan content timing around the peak'
        : ' — steady year-round demand';
  return {
    label,
    geo: geo || 'global',
    peakMonth: fmt(peak.month),
    troughMonth: fmt(trough.month),
    ratio: Math.round(ratio * 10) / 10,
    note: `peak ${fmt(peak.month)}, trough ${fmt(trough.month)}, ${Math.round(ratio * 10) / 10}x swing${warn}`,
  };
}

// Collapse weekly points into monthly averages, then judge the swing.
// Returns { label, peakMonth, troughMonth, ratio, note } or null.
export function analyzeSeasonality(keyword, geo = '', months = 12) {
  return getInterest(keyword, geo, months).then((series) => {
    if (!series || series.length < 20) return null;
    return judgeSeasonality(series, geo);
  });
}

// Cached wrapper used by the pipeline. Never throws — returns null on failure.
export async function checkSeasonality(keyword, geo = '', months = 12) {
  const ck = `tr::${geo.toUpperCase()}::${keyword.toLowerCase()}::${months}m`;
  const hit = cacheGet(ck);
  if (hit) return hit.payload;
  const result = await analyzeSeasonality(keyword, geo, months).catch(() => null);
  if (result) cacheSet(ck, result);
  return result;
}

function arg(name, def = '') {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

if (process.argv[1]?.endsWith('trends.mjs')) {
  const keyword = arg('--keyword');
  if (!keyword) {
    console.log('Usage: node trends.mjs --keyword "sennik" --geo PL');
    process.exit(1);
  }
  checkSeasonality(keyword, arg('--geo', 'PL').toUpperCase()).then((r) => {
    if (!r) {
      console.log('No Trends data (rate-limited or keyword too thin) — treated as unknown.');
      return;
    }
    console.log(`"${keyword}" (${r.geo}): ${r.label} — ${r.note}`);
  });
}
