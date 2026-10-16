// Outcome log for the learning loop. After each run you review candidates;
// record what you DID with them so the agent learns which signals predict wins.
// Usage:
//   node feedback.mjs log --program "sennik" --country Poland --outcome won --notes "built site, 12k visits/mo"
//   node feedback.mjs log --program "xyz" --outcome dropped --notes "DR came back 45 in Ahrefs"
//   node feedback.mjs list
// Outcomes: won (built + real traffic) | lost (built, flopped) | testing (in progress) | dropped (you passed)
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';

const OUTCOMES = ['won', 'lost', 'testing', 'dropped'];

function feedbackFile(dataDir = './data') {
  mkdirSync(dataDir, { recursive: true });
  return `${dataDir}/feedback.jsonl`;
}

export function logOutcome({ program, country = '', outcome, notes = '' }, dataDir = './data') {
  if (!OUTCOMES.includes(outcome)) throw new Error(`outcome must be one of: ${OUTCOMES.join(', ')}`);
  if (!program) throw new Error('--program is required');
  const entry = {
    date: new Date().toISOString().slice(0, 10),
    program,
    country,
    outcome,
    notes,
  };
  appendFileSync(feedbackFile(dataDir), JSON.stringify(entry) + '\n');
  return entry;
}

export function readFeedback(dataDir = './data') {
  const f = feedbackFile(dataDir);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function arg(name, def = '') {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

if (process.argv[1]?.endsWith('feedback.mjs')) {
  const cmd = process.argv[2];
  if (cmd === 'log') {
    try {
      const entry = logOutcome({
        program: arg('--program'),
        country: arg('--country'),
        outcome: arg('--outcome'),
        notes: arg('--notes'),
      });
      console.log(`Logged: ${entry.program} (${entry.country || 'n/a'}) → ${entry.outcome}`);
    } catch (e) {
      console.error('Error:', e.message);
      process.exit(1);
    }
  } else if (cmd === 'list') {
    const entries = readFeedback();
    if (!entries.length) {
      console.log('No feedback logged yet. Use: node feedback.mjs log --program "..." --outcome won|lost|testing|dropped');
      process.exit(0);
    }
    const counts = {};
    for (const e of entries) counts[e.outcome] = (counts[e.outcome] || 0) + 1;
    console.log(`Feedback log: ${entries.length} entries (${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')})`);
    for (const e of entries) {
      console.log(`  ${e.date}  ${e.program} (${e.country || 'n/a'})  → ${e.outcome}${e.notes ? `  — ${e.notes}` : ''}`);
    }
    console.log('\nThen run: node learn.mjs');
  } else {
    console.log('Usage:');
    console.log('  node feedback.mjs log --program "sennik" --country Poland --outcome won --notes "..."');
    console.log('  node feedback.mjs list');
  }
}
