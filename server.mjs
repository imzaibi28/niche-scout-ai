// Niche Scout AI — HOSTED DEMO (read-only, judge-safe).
// This is the submission build: it serves ONE validated agent run
// (data/demo.json) and never runs live searches — POST /api/search is
// disabled, because a live search needs the local agent, its API keys
// and a logged-in KWscanner session, none of which are ever hosted.
// Verdicts and build briefs call Muse Spark Open via env vars
// (LLM_BASE_URL / LLM_MODEL / LLM_API_KEY) when the host provides them,
// and fall back to clearly-labeled cached/saved content when not.
// It does NOT replace the demo: "Find niches" still filters data/demo.json.
// "Live search" runs the real agent (../run.mjs) for ONE market only and
// shows what it actually found, with real volumes / OPR / evidence.
// Local only: never deploy this live-search version publicly — it would
// expose your Tavily / OPR / KWscanner keys and session to the internet.
// Run: node server.mjs  (from the web-shell folder). Open http://localhost:3000
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { getVerdict } from "./verdict.mjs";
import { getBrief } from "./brief.mjs";
import { lookupDomains, lookupDomain, exactMatchDomain, revenueEstimate } from "./domain.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "data", "demo.json");
const OUTCOMES = path.join(__dirname, "data", "outcomes.json");
const LIVE_RESULT = path.join(__dirname, "data", "live-result.json");
const LIVE_LOG = path.join(__dirname, "data", "live-search.log");
const FAVORITES = path.join(__dirname, "data", "favorites.json");
const HISTORY_DIR = path.join(__dirname, "data", "live-history");
const HISTORY_INDEX = path.join(__dirname, "data", "search-history.json");
const PUBLIC = path.join(__dirname, "public");
// Agent root = parent of web-shell (D:\niche-scout-ai). run.mjs lives there,
// along with .env, data/cache, data/kwscanner-session.json, config.mjs.
const AGENT_ROOT = path.join(__dirname, "..");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "niche";
}
function loadDemo() {
  const data = readJson(DATA, { sample: true, niches: [] });
  const outcomes = readJson(OUTCOMES, {});
  return { sample: data.sample === true, niches: applyOutcomes(data.niches || [], outcomes) };
}
function applyOutcomes(niches, outcomes) {
  const favs = readJson(FAVORITES, {});
  return niches.map((n) => {
    const outcome = outcomes[n.id];
    let score = n.score ?? 0;
    if (outcome === "won") score += 5;
    if (outcome === "lost") score -= 10;
    if (outcome === "dropped") score -= 100;
    const rev = revenueEstimate(n.volume, n.cpc);
    return { ...n, outcome: outcome || null, adjustedScore: score, favorite: !!favs[n.id], revenueLow: rev?.low ?? null, revenueHigh: rev?.high ?? null, revenueNote: rev?.assumptions ?? null };
  }).sort((a, b) => b.adjustedScore - a.adjustedScore);
}
function stageFromLog(log) {
  const m = [...(log || "").matchAll(/\[(\d+)\/10\]/g)].pop();
  const n = m ? parseInt(m[1], 10) : 0;
  const labels = { 1: "Searching seed queries", 2: "Filtering opportunities", 3: "Authority (OPR) + domain ages", 4: "Serper cross-check", 5: "Volume (KWscanner)", 6: "Seasonality (Trends)", 7: "Cluster expansion", 8: "Content-gap briefs", 9: "Writing report", 10: "Diff vs previous run" };
  return { stage: n, label: labels[n] || (n ? "Running" : "Starting") };
}
function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(niches) {
  const cols = ["keyword", "country", "language", "interest", "score", "volume", "cpc", "competition", "drUnder20", "volumePass", "seasonality", "zeroClickRisk", "revenueLowUSDmo", "revenueHighUSDmo", "evidence", "cluster", "contentGap"];
  const rows = niches.map((n) => cols.map((c) => {
    if (c === "evidence") return (n.evidence || []).join(";");
    if (c === "cluster") return (n.cluster || []).join(";");
    if (c === "revenueLowUSDmo") return n.revenueLow;
    if (c === "revenueHighUSDmo") return n.revenueHigh;
    return n[c];
  }).map(csvEscape).join(","));
  return cols.join(",") + "\n" + rows.join("\n");
}
function loadLive() {
  const data = readJson(LIVE_RESULT, null);
  if (!data || !Array.isArray(data.niches)) return null;
  const outcomes = readJson(OUTCOMES, {});
  return { sample: false, live: true, niches: applyOutcomes(data.niches, outcomes), meta: data.meta || {} };
}
function findNiche(id) {
  const demo = loadDemo().niches.find((n) => n.id === id);
  if (demo) return demo;
  const live = loadLive();
  return live ? live.niches.find((n) => n.id === id) : null;
}
function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
function sendFile(res, file) {
  const ext = path.extname(file);
  const type = ext === ".css" ? "text/css" : ext === ".js" ? "text/javascript" : "text/html";
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": type });
    res.end(buf);
  });
}

// ---- Convert a raw agent opportunity (opportunities-*.json) to a web-shell niche ----
function convertOpportunity(o) {
  const volume = o.volume && o.volume.value !== null ? o.volume.value : null;
  const dr = o.lowAuthorityCount ?? 0;
  const top10 = (o.domainAuthority || []).map((d) => d.opr ?? null);
  const volPass = volume !== null && volume > 50000;
  const authPass = dr >= 3;
  let cachedVerdict;
  if (volPass && authPass) {
    cachedVerdict = `STRONGEST VALIDATED WINNER (live run). Passes BOTH hard filters: volume ${volume.toLocaleString()}/mo (>50k, KWscanner Global${o.volume?.cpc ? `, CPC ${o.volume.cpc}, Comp ${o.volume.competition || "?"}` : ""}) AND ${dr}/10 top domains with very low authority (OPR ≤2, DR<20 proxy). Score ${o.score}/100.`;
  } else if (volPass) {
    cachedVerdict = `VOLUME PASS, AUTHORITY FAIL (live run). Volume ${volume.toLocaleString()}/mo (>50k) but only ${dr}/10 top domains with low authority — needs a differentiated angle, not a giant-free-top-3 claim. Score ${o.score}/100.`;
  } else if (authPass) {
    cachedVerdict = `AUTHORITY PASS, VOLUME FAIL (live run). ${dr}/10 top domains with low authority, but volume ${volume === null ? "unknown" : volume.toLocaleString() + "/mo"} does not pass the >50k filter. Score ${o.score}/100.`;
  } else {
    cachedVerdict = `NOT A WINNER YET (live run). Volume ${volume === null ? "unknown" : volume.toLocaleString() + "/mo"} (needs >50k) and ${dr}/10 low-authority domains (needs 3+). Score ${o.score}/100. Kept in the list for transparency, not presented as a winner.`;
  }
  const brief = o.contentBrief;
  const contentGap = brief
    ? `Content brief from ${brief.pagesAnalyzed} pages analysed: target ~${brief.medianWords} words (range ${brief.minWords}-${brief.maxWords})${brief.mustCoverTopics?.length ? `, must cover: ${brief.mustCoverTopics.map((t) => t.topic).join(", ")}` : ""}.`
    : "No content brief (not in top-N / below volume filter in this run).";
  const cluster = [
    ...((o.longtails || []).slice(0, 6)),
    ...((o.cluster || []).map((c) => c.query).slice(0, 3)),
  ];
  return {
    id: `live-${slug(o.country)}-${slug(o.query)}`,
    keyword: o.query,
    country: o.country,
    language: o.language,
    interest: o.category,
    program: o.program,
    score: o.score ?? 0,
    volume,
    volumePass: o.volumePass ?? volPass,
    cpc: o.volume?.cpc ?? null,
    competition: o.volume?.competition ?? null,
    drUnder20: dr,
    top10,
    youngDomains: o.youngDomainCount != null
      ? `${o.youngDomainCount} domains in top 10 under 1 year old`
      : "Unknown — domain age check skipped (KWscanner Tools-page navigation bug)",
    zeroClick: (o.zeroClick?.risk === "high") || (o.zeroClick?.penalty || 0) > 0,
    zeroClickRisk: o.zeroClick?.risk || "unknown",
    seasonality: o.seasonality?.label || "Unknown",
    evidence: (o.topResults || []).map((r) => r.url).filter(Boolean),
    signals: o.signals || [],
    cluster,
    contentGap,
    skeleton: "Home (calculator) / How it works / Guide / FAQ / About",
    cachedVerdict,
    domains: (o.domainAuthority || []).map((d) => ({ domain: d.domain, opr: d.opr ?? null })),
    exactMatchDomain: exactMatchDomain(o.query),
  };
}
function newestOpportunitiesFile(afterMs) {
  const dir = path.join(AGENT_ROOT, "data");
  let best = null;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/^opportunities-\d{4}-\d{2}-\d{2}.*\.json$/.test(f)) continue;
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      if (afterMs && st.mtimeMs < afterMs) continue;
      if (!best || st.mtimeMs > best.mtimeMs) best = { file: full, mtimeMs: st.mtimeMs };
    }
  } catch {}
  return best ? best.file : null;
}

// ---- Live search job (one at a time, local only) ----
let job = null; // { id, status, country, language, category, startedAt, log, error, niches, meta }
function normalizeCategory(raw) {
  const s = String(raw || "").toLowerCase().trim();
  const map = { calculator: "calculators", converter: "converters", checker: "checkers", generator: "generators", tracker: "trackers", winner: "winners", lookup: "lookup" };
  return map[s] || s;
}
function startLiveSearch({ country, language, interest, volumeMin, drMin }) {
  const category = normalizeCategory(interest);
  if (!country || !category) {
    return { error: "Country and interest/category are required for live search. Example: Mexico, Spanish, calculators." };
  }
  if (job && job.status === "running") {
    return { error: "A live search is already running. Wait for it to finish before starting another." };
  }
  const runFile = path.join(AGENT_ROOT, "run.mjs");
  if (!fs.existsSync(runFile)) {
    return { error: `Agent entry not found: ${runFile}. Live search must run from a web-shell folder inside the agent folder (parent must contain run.mjs, .env, config.mjs).` };
  }
  const id = Date.now().toString(36);
  const startedAt = Date.now();
  job = { id, status: "running", country, language, category, startedAt, log: "", error: null, niches: null, meta: null, volumeMin: volumeMin ?? 50000, drMin: drMin ?? 3 };
  const args = ["run.mjs", `--country=${country}`, `--category=${category}`];
  if (language) args.push(`--language=${language}`);
  const child = spawn("node", args, { cwd: AGENT_ROOT, env: process.env });
  const append = (chunk) => {
    job.log += chunk.toString();
    if (job.log.length > 20000) job.log = job.log.slice(-20000);
    try { fs.writeFileSync(LIVE_LOG, job.log); } catch {}
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("error", (e) => {
    job.status = "error";
    job.error = `Failed to start run.mjs: ${e.message}`;
  });
  child.on("close", (code) => {
    if (job.status === "error") return;
    if (code !== 0) {
      job.status = "error";
      job.error = `run.mjs exited with code ${code}. Check the log below — common causes: no queries match (check country/category spelling against seeds.mjs), Tavily/OPR key missing, or KWscanner session expired (run: node kwscanner.mjs --login).`;
      return;
    }
    const file = newestOpportunitiesFile(startedAt - 1000);
    if (!file) {
      job.status = "error";
      job.error = "run.mjs finished but no new data/opportunities-*.json was written. Check the log — the run may have filtered everything out (scoreThreshold in config.mjs).";
      return;
    }
    const raw = readJson(file, null);
    if (!Array.isArray(raw)) {
      job.status = "error";
      job.error = `Could not read opportunities from ${file}.`;
      return;
    }
    // Dedupe by program, keep highest score (same method as the validated demo).
    const byProgram = new Map();
    for (const o of raw) {
      const key = String(o.program || o.query).toLowerCase();
      if (!byProgram.has(key) || (o.score || 0) > (byProgram.get(key).score || 0)) byProgram.set(key, o);
    }
    const niches = applyOutcomes([...byProgram.values()].map(convertOpportunity).sort((a, b) => b.score - a.score), readJson(OUTCOMES, {}));
    const meta = { sourceFile: path.basename(file), rawCount: raw.length, uniqueCount: niches.length, finishedAt: new Date().toISOString(), country: job.country, language: job.language, category: job.category, volumeMin: job.volumeMin, drMin: job.drMin };
    try {
      fs.writeFileSync(LIVE_RESULT, JSON.stringify({ sample: false, live: true, meta, niches }, null, 2));
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
      const histFile = path.join(HISTORY_DIR, `${job.id}.json`);
      fs.writeFileSync(histFile, JSON.stringify({ sample: false, live: true, meta, niches }, null, 2));
      const idx = readJson(HISTORY_INDEX, []);
      idx.unshift({ id: job.id, ...meta });
      fs.writeFileSync(HISTORY_INDEX, JSON.stringify(idx.slice(0, 50), null, 2));
    } catch {}
    job.status = "done";
    job.niches = niches;
    job.meta = meta;
  });
  return { jobId: id };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/niches") {
    const { sample, niches } = loadDemo();
    const q = (s) => (s || "").toLowerCase();
    const country = q(url.searchParams.get("country"));
    const language = q(url.searchParams.get("language"));
    const interest = q(url.searchParams.get("interest"));
    const filtered = niches.filter((n) =>
      (!country || q(n.country).includes(country)) &&
      (!language || q(n.language).includes(language)) &&
      (!interest || q(n.interest).includes(interest) || q(n.keyword).includes(interest)));
    send(res, 200, { sample, niches: filtered });
    return;
  }
  if (url.pathname === "/api/live") {
    const live = loadLive();
    send(res, 200, live || { sample: false, live: true, niches: [], meta: {} });
    return;
  }
  if (url.pathname === "/api/search" && req.method === "POST") {
    send(res, 403, { error: "Live search is disabled in the hosted demo. A live search needs the local agent, its API keys and a logged-in KWscanner session — none of those are hosted. This demo shows a validated agent run instead; see the project README to run live searches locally." });
    return;
  }
  if (url.pathname.startsWith("/api/search/")) {
    if (!job) { send(res, 404, { error: "No live search job yet." }); return; }
    const st = stageFromLog(job.log);
    send(res, 200, {
      id: job.id, status: job.status, country: job.country, language: job.language, category: job.category,
      startedAt: job.startedAt, error: job.error, meta: job.meta, stage: st.stage, stageLabel: st.label,
      volumeMin: job.volumeMin, drMin: job.drMin,
      logTail: (job.log || "").slice(-3000),
      niches: job.status === "done" ? job.niches : null,
    });
    return;
  }

  if (url.pathname === "/api/favorites" && req.method === "GET") {
    send(res, 200, readJson(FAVORITES, {}));
    return;
  }
  if (url.pathname === "/api/favorites" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try {
        const { id, fav } = JSON.parse(body || "{}");
        const favs = readJson(FAVORITES, {});
        if (fav) favs[id] = true; else delete favs[id];
        fs.writeFileSync(FAVORITES, JSON.stringify(favs, null, 2));
        send(res, 200, { ok: true, id, fav: !!fav });
      } catch (e) { send(res, 500, { error: String(e.message || e) }); }
    });
    return;
  }
  if (url.pathname === "/api/history") {
    send(res, 200, readJson(HISTORY_INDEX, []));
    return;
  }
  if (url.pathname.startsWith("/api/history/")) {
    const hid = decodeURIComponent(url.pathname.split("/")[3] || "").replace(/[^a-z0-9_-]/gi, "");
    const data = readJson(path.join(HISTORY_DIR, hid + ".json"), null);
    if (!data) { send(res, 404, { error: "History entry not found" }); return; }
    const outcomes = readJson(OUTCOMES, {});
    send(res, 200, { ...data, niches: applyOutcomes(data.niches || [], outcomes) });
    return;
  }
  if (url.pathname === "/api/export") {
    const source = url.searchParams.get("source") || "live";
    let niches = [];
    if (source === "demo") niches = loadDemo().niches;
    else if (source === "history") {
      const hid = (url.searchParams.get("id") || "").replace(/[^a-z0-9_-]/gi, "");
      const data = readJson(path.join(HISTORY_DIR, hid + ".json"), null);
      niches = data ? applyOutcomes(data.niches || [], readJson(OUTCOMES, {})) : [];
    } else {
      const live = loadLive();
      niches = live ? live.niches : [];
    }
    res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="niches-${source}.csv"` });
    res.end(toCsv(niches));
    return;
  }
  if (url.pathname === "/api/domain-check") {
    const single = url.searchParams.get("domain");
    const multi = url.searchParams.get("domains");
    (async () => {
      try {
        if (single) {
          const r = await lookupDomain(single);
          send(res, 200, { results: [r] });
        } else if (multi) {
          const results = await lookupDomains(multi.split(",").map((s) => s.trim()).filter(Boolean), 10);
          const young = results.filter((r) => r.young === true).length;
          send(res, 200, { results, youngCount: young, youngPass: young >= 2, note: "Young = registered <365 days ago. 2+ young in top 10 = new sites breaking in." });
        } else {
          send(res, 400, { error: "Provide ?domain=example.com or ?domains=a.com,b.com (max 10)" });
        }
      } catch (e) { send(res, 500, { error: String(e.message || e) }); }
    })();
    return;
  }
  if (url.pathname.startsWith("/api/niches/")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const niche = findNiche(id);
    if (!niche) { send(res, 404, { error: "Niche not found" }); return; }
    send(res, 200, niche);
    return;
  }
  if (url.pathname === "/api/verdict" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      try {
        const { id } = JSON.parse(body || "{}");
        const niche = findNiche(id);
        if (!niche) { send(res, 404, { error: "Niche not found" }); return; }
        const result = await getVerdict(niche);
        send(res, result.status, result);
      } catch (e) { send(res, 500, { error: String(e.message || e) }); }
    });
    return;
  }
  if (url.pathname === "/api/brief" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      try {
        const { id } = JSON.parse(body || "{}");
        const niche = findNiche(id);
        if (!niche) { send(res, 404, { error: "Niche not found" }); return; }
        const result = await getBrief(niche);
        send(res, result.status, result);
      } catch (e) { send(res, 500, { error: String(e.message || e) }); }
    });
    return;
  }
  if (url.pathname === "/api/outcomes" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try {
        const { id, status } = JSON.parse(body || "{}");
        if (!["won", "lost", "testing", "dropped"].includes(status)) { send(res, 400, { error: "Bad status" }); return; }
        const outcomes = readJson(OUTCOMES, {});
        outcomes[id] = status;
        fs.writeFileSync(OUTCOMES, JSON.stringify(outcomes, null, 2));
        send(res, 200, { ok: true, id, status });
      } catch (e) { send(res, 500, { error: String(e.message || e) }); }
    });
    return;
  }
  const file = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const safe = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ""));
  if (!safe.startsWith(PUBLIC)) { res.writeHead(403); res.end("Forbidden"); return; }
  sendFile(res, safe);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Niche Scout AI hosted demo (read-only) on http://localhost:${PORT}`));
