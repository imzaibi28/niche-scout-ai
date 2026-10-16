// kwscanner.mjs — search-volume step via KWscanner's bulk research tool.
// KWscanner has no public API, so this drives the logged-in web dashboard
// with Playwright using a saved session (no password stored anywhere).
//
// First-time setup (on YOUR machine):
//   npm install playwright
//   npx playwright install chromium
//   node kwscanner.mjs --login     # opens a browser: log in manually (OTP included),
//                                  # then press Enter in this terminal. Session saved to
//                                  # data/kwscanner-session.json and reused afterwards.
//
// Usage in pipeline: attachVolumes(opportunities, config)
// Standalone:        node kwscanner.mjs --check "sennik,mapa astral" [--country global]
// Calibrate:         node kwscanner.mjs --map   # dumps the page's interactive elements
//                                              # to data/kwscanner-dom-map.txt — if the
//                                              # bulk flow ever breaks, send that file
//                                              # back and the selectors below get fixed.
//
// Notes: KWscanner country DBs are Global/US/UK/CA/AU/IN/NZ/ZA only — there is no
// Poland/Brazil/Romania DB, so 'global' is the default. Volumes are Google Keyword
// Planner-sourced (not invented). Each lookup costs KWscanner credits; per-keyword
// results are cached so re-runs are free.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { config } from './config.mjs';
import { cacheGet, cacheSet } from './cache.mjs';
import { sleep, domainOf } from './util.mjs';

// ---------------------------------------------------------------------------
// SELECTOR MAP — calibrate with `node kwscanner.mjs --map` if the flow breaks.
// Each entry is a list of fallback strategies tried in order.
// ---------------------------------------------------------------------------
const SELECTORS = {
  // Signs we are logged in (any one match = session valid)
  loggedIn: [
    'a[href*="logout"], button:has-text("Log out"), button:has-text("Logout")',
    '[data-testid*="avatar"], .user-avatar, img[alt*="avatar" i]',
    'nav a[href*="list"], nav a[href*="keyword"]',
  ],
  // Signs we are on the login screen (any one match = session dead)
  loggedOut: [
    'input[type="password"]',
    'button:has-text("Sign in"), button:has-text("Log in")',
  ],
  // Entries that lead to the bulk keyword input view
  bulkEntry: [
    'a:has-text("Bulk")', 'button:has-text("Bulk")',
    'a:has-text("Keyword list")', 'button:has-text("Keyword list")',
    'a:has-text("New list")', 'button:has-text("New list")',
  ],
  // Country picker (select element preferred; menu button as fallback)
  countrySelect: ['select[name*="country" i], select[id*="country" i], select:has(option:text-is("Global"))'],
  countryButton: ['button:has-text("Global"), button:has-text("Country")'],
  // Submit / research button on the bulk input view
  submit: [
    'button:has-text("Research")', 'button:has-text("Get data")',
    'button:has-text("Check keywords")', 'button[type="submit"]',
  ],
  // Results table: the table whose header mentions Volume
  resultsTable: ['table:has(th:text-is("Volume")), table:has(th:text-matches("Volume", "i"))'],
  // Domain Age Checker entries + results table (header mentions Age)
  ageEntry: [
    'a:has-text("Domain Age")', 'button:has-text("Domain Age")',
    'a:has-text("Age Checker")', 'button:has-text("Age Checker")',
    'a[href*="age" i]', 'button:has-text("Whois")',
  ],
  ageResultsTable: ['table:has(th:text-matches("Age", "i"))'],
};

const APP_URL = process.env.KWSCANNER_APP_URL || 'https://app.kwscanner.com';
const DEBUG = process.env.KWSCANNER_DEBUG === '1';

function sessionFile() {
  mkdirSync(config.dataDir, { recursive: true });
  return `${config.dataDir}/kwscanner-session.json`;
}

// "1,830,000" -> 1830000 ; "60.5K" -> 60500 ; "2.74M" -> 2740000 ; "-" -> null
export function parseVolume(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/[,\s]/g, '').replace(/\/mo.*$/i, '');
  if (!s || s === '-' || s === '—' || /^n\/?a$/i.test(s)) return null;
  const m = s.match(/^([\d.]+)([KMB])?$/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1;
  const v = Math.round(parseFloat(m[1]) * mult);
  return Number.isFinite(v) ? v : null;
}

// Pure function: rows are { keyword, volume, cpc, competition } cell strings.
// Kept DOM-free so it can be unit-tested without a browser.
export function parseVolumeRows(rows) {
  return rows.map((r) => ({
    keyword: String(r.keyword || '').trim().toLowerCase(),
    volume: parseVolume(r.volume),
    cpc: r.cpc != null ? String(r.cpc).trim() : null,
    competition: r.competition != null ? String(r.competition).trim() : null,
  })).filter((r) => r.keyword);
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    throw new Error(
      'Playwright is not installed. Run: npm install playwright && npx playwright install chromium'
    );
  }
}

async function firstMatch(page, selectors, { timeout = 8000 } = {}) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: 'visible', timeout });
      return loc;
    } catch { /* try next */ }
  }
  return null;
}

function shot(page, name) {
  if (!DEBUG) return Promise.resolve();
  return page.screenshot({ path: `${config.dataDir}/${name}.png` }).catch(() => {});
}

async function sessionLooksValid(page) {
  for (const sel of SELECTORS.loggedIn) {
    if ((await page.locator(sel).count()) > 0) return true;
  }
  for (const sel of SELECTORS.loggedOut) {
    if ((await page.locator(sel).count()) > 0) return false;
  }
  return false; // unknown state — treat as invalid, safer than scraping garbage
}

async function newSession(headless) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless, slowMo: DEBUG ? 250 : 0 });
  const file = sessionFile();
  let context;
  if (existsSync(file)) {
    try {
      context = await browser.newContext({ storageState: file });
    } catch {
      context = await browser.newContext();
    }
  } else {
    context = await browser.newContext();
  }
  return { browser, context, page: await context.newPage() };
}

async function ensureLoggedIn(page) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  if (await sessionLooksValid(page)) return;
  throw new Error(
    'KWscanner session is missing or expired. Run: node kwscanner.mjs --login'
  );
}

// Navigate to the bulk keyword input view.
async function openBulkView(page) {
  const entry = await firstMatch(page, SELECTORS.bulkEntry, { timeout: 10000 });
  if (!entry) {
    await shot(page, 'kwscanner-no-bulk-entry');
    throw new Error(
      'Could not find the bulk research entry point (UI may have changed). ' +
      'Run: node kwscanner.mjs --map  and send data/kwscanner-dom-map.txt for recalibration.'
    );
  }
  await entry.click();
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await sleep(1500);
}

async function setCountry(page, country) {
  const label = { global: 'Global', us: 'United States', uk: 'United Kingdom', ca: 'Canada', au: 'Australia', in: 'India', nz: 'New Zealand', za: 'South Africa' }[country.toLowerCase()] || 'Global';
  // Strategy 1: native <select>
  for (const sel of SELECTORS.countrySelect) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      await loc.selectOption({ label }).catch(() => loc.selectOption({ index: 0 }));
      await sleep(800);
      return;
    }
  }
  // Strategy 2: menu button — open it and pick the option
  const btn = await firstMatch(page, SELECTORS.countryButton, { timeout: 4000 });
  if (btn) {
    await btn.click();
    await sleep(600);
    const opt = page.locator(`[role="option"]:has-text("${label}"), li:has-text("${label}")`).first();
    if ((await opt.count()) > 0) await opt.click();
    await sleep(800);
  }
  // If neither exists, the tool is probably already on Global — continue.
}

async function pasteAndSubmit(page, keywords) {
  // Largest visible textarea on the page is the keyword paste box.
  const areas = page.locator('textarea:visible');
  const n = await areas.count();
  if (!n) {
    await shot(page, 'kwscanner-no-textarea');
    throw new Error('No keyword input box found on the bulk view. Run --map for recalibration.');
  }
  let box = areas.first(), best = -1;
  for (let i = 0; i < n; i++) {
    const b = await areas.nth(i).boundingBox().catch(() => null);
    const size = b ? b.width * b.height : 0;
    if (size > best) { best = size; box = areas.nth(i); }
  }
  await box.click();
  await box.fill(keywords.join('\n'));
  await sleep(500);
  const submit = await firstMatch(page, SELECTORS.submit, { timeout: 8000 });
  if (!submit) {
    await shot(page, 'kwscanner-no-submit');
    throw new Error('Could not find the Research/Submit button. Run --map for recalibration.');
  }
  await submit.click();
}

// Wait for streaming results to settle, then scrape the table.
// Header-driven: finds the table whose headers mention Volume, maps columns by name.
async function scrapeResults(page, expectedCount) {
  const deadline = Date.now() + 180000;
  let lastCount = 0, stableSince = Date.now();
  while (Date.now() < deadline) {
    const table = await firstMatch(page, SELECTORS.resultsTable, { timeout: 5000 });
    if (table) {
      const rows = await table.locator('tbody tr').count();
      if (rows >= expectedCount) break;
      if (rows === lastCount && rows > 0 && Date.now() - stableSince > 25000) break; // settled
      if (rows !== lastCount) { lastCount = rows; stableSince = Date.now(); }
    }
    await sleep(2500);
  }
  const table = await firstMatch(page, SELECTORS.resultsTable, { timeout: 5000 });
  if (!table) {
    await shot(page, 'kwscanner-no-results');
    throw new Error('Results table never appeared (timeout). Screenshot saved for debugging.');
  }
  return table.evaluate((t) => {
    const norm = (s) => s.trim().toLowerCase();
    const headers = [...t.querySelectorAll('thead th')].map((th) => norm(th.textContent));
    const col = (names) => headers.findIndex((h) => names.some((x) => h.includes(x)));
    const iKw = col(['keyword', 'term']), iVol = col(['volume']), iCpc = col(['cpc']), iComp = col(['competition', 'comp.']);
    return [...t.querySelectorAll('tbody tr')].map((tr) => {
      const c = [...tr.querySelectorAll('td')].map((td) => td.textContent.trim());
      return {
        keyword: iKw >= 0 ? c[iKw] : c[0],
        volume: iVol >= 0 ? c[iVol] : null,
        cpc: iCpc >= 0 ? c[iCpc] : null,
        competition: iComp >= 0 ? c[iComp] : null,
      };
    });
  });
}

const volCacheKey = (country, kw) => `kwsc:${country.toLowerCase()}:${kw.trim().toLowerCase()}`;

export async function fetchVolumes(keywords, { country } = {}) {
  const ctry = (country || config.kwscanner?.country || 'global').toLowerCase();
  const kws = [...new Set(keywords.map((k) => String(k).trim()).filter(Boolean))];
  const results = new Map();
  const missing = [];
  for (const kw of kws) {
    const hit = cacheGet(volCacheKey(ctry, kw));
    if (hit) results.set(kw.toLowerCase(), { ...hit.payload, cached: true });
    else missing.push(kw);
  }
  if (!missing.length) return results;

  const { browser, page } = await newSession(config.kwscanner?.headless ?? true);
  try {
    await ensureLoggedIn(page);
    const batchSize = config.kwscanner?.batchSize || 500;
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      console.log(`  KWscanner batch ${i / batchSize + 1}: ${batch.length} keywords...`);
      await openBulkView(page);
      await setCountry(page, ctry);
      await pasteAndSubmit(page, batch);
      const rows = parseVolumeRows(await scrapeResults(page, batch.length));
      for (const r of rows) {
        const rec = { volume: r.volume, cpc: r.cpc, competition: r.competition, country: ctry, fetchedAt: new Date().toISOString() };
        cacheSet(volCacheKey(ctry, r.keyword), rec);
        results.set(r.keyword, rec);
      }
      // Keywords the tool returned nothing for: cache the miss so we don't repay.
      for (const kw of batch) {
        if (!results.has(kw.toLowerCase())) {
          const rec = { volume: null, cpc: null, competition: null, country: ctry, fetchedAt: new Date().toISOString() };
          cacheSet(volCacheKey(ctry, kw), rec);
          results.set(kw.toLowerCase(), rec);
        }
      }
      await sleep(config.delayMs || 1200);
    }
  } finally {
    await browser.close();
  }
  return results;
}

// Attach volume data to opportunities. Never throws — on any failure it warns
// and leaves opportunities untouched so the rest of the pipeline still runs.
export async function attachVolumes(opportunities, cfg = config) {
  const kw = cfg.kwscanner || {};
  if (kw.enabled === false) return opportunities;
  const keywords = opportunities.map((o) => o.query).filter(Boolean);
  if (!keywords.length) return opportunities;
  let volumes;
  try {
    volumes = await fetchVolumes(keywords, { country: kw.country });
  } catch (e) {
    console.warn(`  [kwscanner] volume step skipped: ${e.message}`);
    return opportunities;
  }
  const min = kw.volumeMin ?? 50000;
  for (const o of opportunities) {
    const rec = volumes.get(String(o.query).trim().toLowerCase());
    o.volume = rec ? { value: rec.volume, cpc: rec.cpc, competition: rec.competition, country: rec.country, source: 'kwscanner' + (rec.cached ? ' (cached)' : '') } : null;
    o.volumePass = o.volume && o.volume.value !== null ? o.volume.value >= min : undefined; // undefined = unknown
    if (o.volumePass === false) o.signals.push(`volume ${o.volume.value.toLocaleString()}/mo < ${min.toLocaleString()} filter`);
  }
  // Winners first: volume pass, then weak-domain count, then score.
  opportunities.sort(
    (a, b) =>
      (b.volumePass === true) - (a.volumePass === true) ||
      (b.lowAuthorityCount ?? 0) - (a.lowAuthorityCount ?? 0) ||
      b.score - a.score
  );
  return opportunities;
}

// ---------------------------------------------------------------------------
// Domain age check — "2+ domains under 1 year old in the top 10" rule.
// Drives KWscanner's free Domain Age Checker the same Playwright way as volumes.
// ---------------------------------------------------------------------------

// "2 years 3 months" -> ~821 ; "456 days" -> 456 ; "2021-03-15" -> days since
// that date ; "Mar 15, 2021" -> same. Returns integer days or null.
export function parseDomainAge(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === '-' || s === '—' || /^n\/?a$/i.test(s)) return null;

  // Creation-date formats first: YYYY-MM-DD or "Mar 15, 2021" / "15 Mar 2021"
  const dateM = s.match(/(\d{4})-(\d{2})-(\d{2})/) ||
    s.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/) ||
    s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (dateM) {
    const t = new Date(s).getTime();
    if (!Number.isNaN(t)) return Math.max(0, Math.round((Date.now() - t) / 86400000));
  }
  // Relative formats: "2 years 3 months", "1y 6m", "456 days", "18 months"
  const y = (s.match(/([\d.]+)\s*y(?:ears?)?\b/i) || [])[1];
  const mo = (s.match(/([\d.]+)\s*m(?:o(?:nths?)?)?\b/i) || [])[1];
  const d = (s.match(/([\d.]+)\s*d(?:ays?)?\b/i) || [])[1];
  if (y !== undefined || mo !== undefined || d !== undefined) {
    const days = (parseFloat(y) || 0) * 365 + (parseFloat(mo) || 0) * 30.4 + (parseFloat(d) || 0);
    return Math.round(days);
  }
  // Bare number = assume days
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

async function openAgeView(page) {
  const entry = await firstMatch(page, SELECTORS.ageEntry, { timeout: 10000 });
  if (!entry) {
    await shot(page, 'kwscanner-no-age-entry');
    throw new Error(
      'Could not find the Domain Age Checker entry point (UI may have changed). ' +
      'Run: node kwscanner.mjs --map  and send data/kwscanner-dom-map.txt for recalibration.'
    );
  }
  await entry.click();
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await sleep(1500);
}

async function scrapeAgeResults(page, expectedCount) {
  const deadline = Date.now() + 120000;
  let lastCount = 0, stableSince = Date.now();
  while (Date.now() < deadline) {
    const table = await firstMatch(page, SELECTORS.ageResultsTable, { timeout: 5000 });
    if (table) {
      const rows = await table.locator('tbody tr').count();
      if (rows >= expectedCount) break;
      if (rows === lastCount && rows > 0 && Date.now() - stableSince > 20000) break;
      if (rows !== lastCount) { lastCount = rows; stableSince = Date.now(); }
    }
    await sleep(2500);
  }
  const table = await firstMatch(page, SELECTORS.ageResultsTable, { timeout: 5000 });
  if (!table) {
    await shot(page, 'kwscanner-no-age-results');
    throw new Error('Age results table never appeared (timeout). Screenshot saved for debugging.');
  }
  return table.evaluate((t) => {
    const norm = (s) => s.trim().toLowerCase();
    const headers = [...t.querySelectorAll('thead th')].map((th) => norm(th.textContent));
    const col = (names) => headers.findIndex((h) => names.some((x) => h.includes(x)));
    const iDom = col(['domain', 'site', 'url']), iAge = col(['age', 'created', 'registered', 'creation']);
    return [...t.querySelectorAll('tbody tr')].map((tr) => {
      const c = [...tr.querySelectorAll('td')].map((td) => td.textContent.trim());
      return { domain: iDom >= 0 ? c[iDom] : c[0], age: iAge >= 0 ? c[iAge] : null };
    });
  });
}

const ageCacheKey = (domain) => `kwsc:age:${domain.trim().toLowerCase()}`;

export async function fetchDomainAges(domains) {
  const doms = [...new Set(domains.map((d) => String(d).trim().toLowerCase()).filter(Boolean))];
  const results = new Map();
  const missing = [];
  for (const d of doms) {
    const hit = cacheGet(ageCacheKey(d));
    if (hit) results.set(d, { ...hit.payload, cached: true });
    else missing.push(d);
  }
  if (!missing.length) return results;

  const { browser, page } = await newSession(config.kwscanner?.headless ?? true);
  try {
    await ensureLoggedIn(page);
    const batchSize = 100; // age checkers usually cap lower than keyword bulk
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      console.log(`  KWscanner age batch ${i / batchSize + 1}: ${batch.length} domains...`);
      await openAgeView(page);
      await pasteAndSubmit(page, batch);
      const rows = await scrapeAgeResults(page, batch.length);
      for (const r of rows) {
        const domain = String(r.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
        if (!domain) continue;
        const rec = { ageDays: parseDomainAge(r.age), raw: r.age, fetchedAt: new Date().toISOString() };
        cacheSet(ageCacheKey(domain), rec);
        results.set(domain, rec);
      }
      for (const d of batch) {
        if (!results.has(d)) {
          const rec = { ageDays: null, raw: null, fetchedAt: new Date().toISOString() };
          cacheSet(ageCacheKey(d), rec);
          results.set(d, rec);
        }
      }
      await sleep(config.delayMs || 1200);
    }
  } finally {
    await browser.close();
  }
  return results;
}

// Pure: count domains younger than maxAgeDays from an ages map.
// ages: Map domain -> { ageDays }. Exported for testing.
export function countYoungDomains(topDomains, ages, maxAgeDays = 365) {
  let young = 0;
  const detail = [];
  for (const d of topDomains) {
    const rec = ages.get(String(d).toLowerCase());
    const ageDays = rec?.ageDays ?? null;
    const isYoung = ageDays !== null && ageDays < maxAgeDays;
    if (isYoung) young++;
    detail.push({ domain: d, ageDays, young: isYoung });
  }
  return { young, total: topDomains.length, detail };
}

// Attach domain ages to opportunities. Never throws — on failure it warns and
// leaves youngDomainCount unset so the rest of the pipeline still runs.
export async function attachDomainAges(opportunities, cfg = config) {
  const ageCfg = cfg.kwscanner?.ageChecker || {};
  if (ageCfg.enabled === false) return opportunities;
  const allDomains = [...new Set(
    opportunities.flatMap((o) => (o.topResults || []).map((r) => domainOf(r.url)))
  )].filter(Boolean);
  if (!allDomains.length) return opportunities;
  let ages;
  try {
    ages = await fetchDomainAges(allDomains);
  } catch (e) {
    console.warn(`  [kwscanner] domain-age step skipped: ${e.message}`);
    return opportunities;
  }
  const maxAge = cfg.youngDomainMaxAgeDays ?? 365;
  for (const o of opportunities) {
    const domains = [...new Set((o.topResults || []).map((r) => domainOf(r.url)).filter(Boolean))].slice(0, 10);
    const { young, detail } = countYoungDomains(domains, ages, maxAge);
    o.domainAges = detail;
    o.youngDomainCount = young;
  }
  return opportunities;
}

// ---------------------------------------------------------------------------
// CLI — only runs when this file is the entry point (not when imported by run.mjs)
// ---------------------------------------------------------------------------
import { pathToFileURL } from 'url';
const isEntryPoint = import.meta.url === pathToFileURL(process.argv[1] || '').href;
const args = isEntryPoint ? process.argv.slice(2) : [];

if (isEntryPoint && args.includes('--login')) {
  const { browser, context, page } = await newSession(false);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  console.log('\nA browser window is open at KWscanner.');
  console.log('Log in manually (complete the OTP step if asked), then press Enter here.\n');
  await new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Press Enter after you are logged in: ', () => { rl.close(); resolve(); });
  });
  const ok = await sessionLooksValid(page);
  if (!ok) console.warn('WARNING: page does not look logged in — saving anyway; re-run --login if the next step fails.');
  await context.storageState({ path: sessionFile() });
  console.log(`Session saved to ${sessionFile()}. Future runs reuse it (no password stored).`);
  await browser.close();
  process.exit(0);
}

if (isEntryPoint && args.includes('--map')) {
  // Diagnostic: dump interactive elements of the post-login landing page.
  const { browser, page } = await newSession(false);
  try {
    await ensureLoggedIn(page);
    const dump = await page.evaluate(() => {
      const els = [...document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="option"]')];
      return els
        .filter((el) => el.offsetParent !== null)
        .slice(0, 400)
        .map((el) => {
          const tag = el.tagName.toLowerCase();
          const text = (el.textContent || el.value || '').trim().slice(0, 80).replace(/\s+/g, ' ');
          const attrs = ['id', 'name', 'placeholder', 'href', 'type', 'data-testid', 'aria-label']
            .map((a) => (el.getAttribute(a) ? `${a}="${el.getAttribute(a).slice(0, 60)}"` : ''))
            .filter(Boolean).join(' ');
          return `<${tag} ${attrs}> ${text}`;
        }).join('\n');
    });
    const out = `${config.dataDir}/kwscanner-dom-map.txt`;
    writeFileSync(out, `URL: ${page.url()}\n\n${dump}\n`);
    await page.screenshot({ path: `${config.dataDir}/kwscanner-dom-map.png` });
    console.log(`Wrote ${out} (+ screenshot). Send it back for selector calibration.`);
  } finally {
    await browser.close();
  }
  process.exit(0);
}

const checkIdx = isEntryPoint ? args.indexOf('--check') : -1;
if (checkIdx !== -1) {
  const kws = (args[checkIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!kws.length) { console.error('Usage: node kwscanner.mjs --check "kw1, kw2" [--country global]'); process.exit(1); }
  const cIdx = args.indexOf('--country');
  const country = cIdx !== -1 ? args[cIdx + 1] : undefined;
  const volumes = await fetchVolumes(kws, { country });
  for (const kw of kws) {
    const r = volumes.get(kw.toLowerCase());
    console.log(`${kw}: ${r && r.volume !== null ? r.volume.toLocaleString() + '/mo' : 'unknown'}${r?.cached ? ' (cached)' : ''} | CPC ${r?.cpc ?? '?'} | comp ${r?.competition ?? '?'}`);
  }
  process.exit(0);
}

const agesIdx = isEntryPoint ? args.indexOf('--ages') : -1;
if (agesIdx !== -1) {
  const doms = (args[agesIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!doms.length) { console.error('Usage: node kwscanner.mjs --ages "example.com, foo.pl"'); process.exit(1); }
  const ages = await fetchDomainAges(doms);
  for (const d of doms) {
    const r = ages.get(d.toLowerCase());
    const label = r?.ageDays !== null && r?.ageDays !== undefined
      ? `${r.ageDays} days old${r.ageDays < 365 ? ' (YOUNG)' : ''}`
      : 'unknown';
    console.log(`${d}: ${label}${r?.cached ? ' (cached)' : ''}`);
  }
  process.exit(0);
}
