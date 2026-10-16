// The learning loop: correlates your logged outcomes (feedback.mjs) with the
// signal families in past opportunity DBs, then writes score adjustments that
// future runs apply automatically via scorer.applyLearnedAdjustments.
// Usage: node learn.mjs
// Honest small-sample guardrails: a family needs >= 3 decided outcomes before
// it earns an adjustment; 'testing' outcomes are excluded from win rates.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { readFeedback } from './feedback.mjs';
import { SIGNAL_FAMILIES } from './scorer.mjs';

const MIN_SAMPLES = 3;
const WIN_BONUS = 5;    // families that win >= 75% of past tests
const LOSE_PENALTY = -10; // families that win <= 25% of past tests

function latestSignals(dataDir) {
  // program|normalized-country -> signals from the most recent DB containing it
  const map = new Map();
  if (!existsSync(dataDir)) return map;
  const files = readdirSync(dataDir)
    .filter((f) => /^opportunities-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  for (const file of files) {
    let db;
    try { db = JSON.parse(readFileSync(`${dataDir}/${file}`, 'utf8')); } catch { continue; }
    for (const o of db) {
      const key = `${(o.program || '').toLowerCase()}|${(o.country || '').toLowerCase()}`;
      if (o.program) map.set(key, o.signals || []);
    }
  }
  return map;
}

function signalFamilies(signals) {
  return SIGNAL_FAMILIES.filter((f) => signals.some((s) => f.test(s))).map((f) => f.id);
}

export function analyze(dataDir = './data') {
  const feedback = readFeedback(dataDir);
  const signalsByKey = latestSignals(dataDir);
  const stats = {};
  for (const f of SIGNAL_FAMILIES) stats[f.id] = { label: f.label, won: 0, lost: 0, samples: 0 };

  let matched = 0;
  let unmatched = 0;
  for (const e of feedback) {
    if (e.outcome === 'testing') continue; // undecided — excluded from win rates
    const key = `${(e.program || '').toLowerCase()}|${(e.country || '').toLowerCase()}`;
    const signals = signalsByKey.get(key);
    if (!signals) { unmatched++; continue; }
    matched++;
    const decided = e.outcome === 'won' ? 'won' : 'lost'; // 'lost' + 'dropped' both count against
    for (const id of signalFamilies(signals)) {
      stats[id][decided]++;
      stats[id].samples++;
    }
  }

  const families = {};
  for (const [id, s] of Object.entries(stats)) {
    const decided = s.won + s.lost;
    const winRate = decided ? Math.round((s.won / decided) * 100) : null;
    let adjustment = 0;
    if (decided >= MIN_SAMPLES && winRate <= 25) adjustment = LOSE_PENALTY;
    else if (decided >= MIN_SAMPLES && winRate >= 75) adjustment = WIN_BONUS;
    families[id] = { label: s.label, samples: decided, won: s.won, lost: s.lost, winRate, adjustment };
  }
  return { feedbackTotal: feedback.length, matched, unmatched, families };
}

export function writeAdjustments(analysis, dataDir = './data') {
  mkdirSync(dataDir, { recursive: true });
  const payload = { generated: new Date().toISOString().slice(0, 10), ...analysis };
  const f = `${dataDir}/learned-adjustments.json`;
  writeFileSync(f, JSON.stringify(payload, null, 2));
  return f;
}

if (process.argv[1]?.endsWith('learn.mjs')) {
  const a = analyze();
  console.log(`Feedback entries: ${a.feedbackTotal} (matched to past runs: ${a.matched}, unmatched: ${a.unmatched})`);
  if (a.unmatched) console.log('  (unmatched = outcome logged for a program with no saved opportunity DB — fine for ad-hoc tests)');
  console.log('\nSignal family performance:');
  for (const [id, f] of Object.entries(a.families)) {
    const rate = f.winRate === null ? 'no data' : `${f.winRate}% (${f.won}W/${f.lost}L)`;
    const adj = f.adjustment ? ` → ${f.adjustment > 0 ? '+' : ''}${f.adjustment}pts` : '';
    console.log(`  ${f.label}: ${rate}${adj}`);
  }
  const f = writeAdjustments(a);
  console.log(`\nAdjustments written to ${f} — future runs apply them automatically.`);
  console.log('Tip: log more outcomes with "node feedback.mjs log ..." and re-run learn.mjs monthly.');
}
