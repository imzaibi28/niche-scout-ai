// Re-run differ — free, zero new dependencies.
//
// Compares two opportunities DB files (data/opportunities-<date>.json) and
// reports what changed between runs: new opportunities, dropped ones, score
// movers, and volume changes. This is what makes weekly re-runs useful —
// law changes, new programs, and SERP shifts surface as a diff instead of
// forcing you to re-read the whole report.
//
// CLI:
//   node diff.mjs                        (diff the two most recent runs)
//   node diff.mjs --from 2026-09-20 --to 2026-09-30
//
// Used by run.mjs step [7/8]: after each run, auto-diffs against the previous
// DB so the console + data/diff-<date>.md show what moved.
import { pathToFileURL } from 'url';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const keyOf = (o) => `${o.country}::${o.program}`;
const fmtVol = (v) => (v?.value != null ? v.value.toLocaleString() : 'unknown');

export function listDbFiles(dataDir = './data') {
  if (!existsSync(dataDir)) return [];
  return readdirSync(dataDir)
    .filter((f) => /^opportunities-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => join(dataDir, f));
}

export function loadOpps(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : data.opportunities || [];
  } catch {
    return [];
  }
}

export function diffRuns(prevOpps, currOpps) {
  const prev = new Map(prevOpps.map((o) => [keyOf(o), o]));
  const curr = new Map(currOpps.map((o) => [keyOf(o), o]));

  const added = [], removed = [], scoreUp = [], scoreDown = [], volumeChanged = [];

  for (const [k, o] of curr) {
    if (!prev.has(k)) {
      added.push(o);
      continue;
    }
    const p = prev.get(k);
    const delta = (o.score || 0) - (p.score || 0);
    if (delta >= 10) scoreUp.push({ key: k, from: p.score, to: o.score, delta });
    else if (delta <= -10) scoreDown.push({ key: k, from: p.score, to: o.score, delta });
    const pv = p.volume?.value ?? null;
    const cv = o.volume?.value ?? null;
    if (pv !== cv && (pv != null || cv != null)) {
      volumeChanged.push({ key: k, from: fmtVol(p.volume), to: fmtVol(o.volume) });
    }
  }
  for (const [k, o] of prev) {
    if (!curr.has(k)) removed.push(o);
  }

  const byScore = (a, b) => (b.score || 0) - (a.score || 0);
  added.sort(byScore);
  removed.sort(byScore);
  scoreUp.sort((a, b) => b.delta - a.delta);
  scoreDown.sort((a, b) => a.delta - b.delta);
  return { added, removed, scoreUp, scoreDown, volumeChanged };
}

export function renderDiffMarkdown(diff, prevStamp, currStamp) {
  const L = [];
  L.push(`# Run diff: ${prevStamp} → ${currStamp}`, '');
  const sec = (title, rows, fmt) => {
    L.push(`## ${title} (${rows.length})`, '');
    if (!rows.length) L.push('_none_', '');
    else rows.slice(0, 20).forEach((r) => L.push(`- ${fmt(r)}`));
    if (rows.length > 20) L.push(`- …and ${rows.length - 20} more`);
    L.push('');
  };
  sec('New opportunities', diff.added, (o) => `${o.program} (${o.country}) — score ${o.score}, vol ${fmtVol(o.volume)}`);
  sec('Dropped out', diff.removed, (o) => `${o.program} (${o.country}) — was score ${o.score}`);
  sec('Score jumped ≥10', diff.scoreUp, (r) => `${r.key} — ${r.from} → ${r.to}`);
  sec('Score fell ≥10', diff.scoreDown, (r) => `${r.key} — ${r.from} → ${r.to}`);
  sec('Volume changed', diff.volumeChanged, (r) => `${r.key} — ${r.from} → ${r.to}/mo`);
  return L.join('\n');
}

// Diff currentOpps against the most recent previous DB (excluding excludeFile).
// Returns { diff, mdFile } or null when there is no previous run.
export function diffWithPrevious(dataDir, currentOpps, excludeFile) {
  const files = listDbFiles(dataDir).filter((f) => f !== excludeFile);
  if (!files.length) return null;
  const prevFile = files[files.length - 1];
  const prevStamp = prevFile.match(/(\d{4}-\d{2}-\d{2})/)[1];
  const currStamp = new Date().toISOString().slice(0, 10);
  const diff = diffRuns(loadOpps(prevFile), currentOpps);
  const mdFile = join(dataDir, `diff-${currStamp}.md`);
  writeFileSync(mdFile, renderDiffMarkdown(diff, prevStamp, currStamp));
  return { diff, mdFile, prevStamp, currStamp };
}

// ---- CLI ----
const isEntryPoint = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isEntryPoint) {
  const args = process.argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  };
  const dataDir = get('--data', './data');
  const files = listDbFiles(dataDir);
  if (files.length < 2 && !(get('--from') && get('--to'))) {
    console.log('Need two runs to diff. Usage: node diff.mjs [--from 2026-09-20 --to 2026-09-30]');
    process.exit(1);
  }
  const fromF = get('--from') ? join(dataDir, `opportunities-${get('--from')}.json`) : files[files.length - 2];
  const toF = get('--to') ? join(dataDir, `opportunities-${get('--to')}.json`) : files[files.length - 1];
  const diff = diffRuns(loadOpps(fromF), loadOpps(toF));
  const stamp = (f) => f.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || f;
  console.log(renderDiffMarkdown(diff, stamp(fromF), stamp(toF)));
}
