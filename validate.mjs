// validate.mjs — closes the loop on the manual validation handoff.
// Reads your filled-in ahrefs-shortlist CSV and produces a winners-only report.
// Usage: node validate.mjs [path/to/ahrefs-shortlist-YYYY-MM-DD.csv]
//   (no argument = newest ahrefs-shortlist-*.csv in ./data)
// A row counts as a WINNER when check_volume_gt_50k AND check_3x_dr_under_20
// are filled with yes / y / true / 1 (case-insensitive).
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0] !== '');
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function escCsv(v) {
  const s = String(v ?? '').replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

function isYes(v) {
  return ['yes', 'y', 'true', '1'].includes(String(v ?? '').trim().toLowerCase());
}

function findShortlist(arg) {
  if (arg && existsSync(arg)) return arg;
  if (!existsSync('./data')) throw new Error('No ./data directory. Run node run.mjs first.');
  const files = readdirSync('./data')
    .filter((f) => f.startsWith('ahrefs-shortlist-') && f.endsWith('.csv'))
    .sort();
  if (!files.length) throw new Error('No ahrefs-shortlist-*.csv found in ./data. Run node run.mjs first.');
  return './data/' + files[files.length - 1];
}

const file = findShortlist(process.argv[2]);
const rows = parseCsv(readFileSync(file, 'utf8'));
const validated = rows.filter(
  (r) => String(r.check_volume_gt_50k ?? '').trim() !== '' && String(r.check_3x_dr_under_20 ?? '').trim() !== ''
);
const winners = validated.filter((r) => isYes(r.check_volume_gt_50k) && isYes(r.check_3x_dr_under_20));

const stamp = new Date().toISOString().slice(0, 10);

// Winners CSV
const cols = ['keyword', 'country', 'language', 'agent_score', 'weak_domains_top10', 'zero_click_risk', 'top_3_urls'];
const csv = [cols.join(',')]
  .concat(winners.map((r) => cols.map((c) => escCsv(r[c])).join(',')))
  .join('\n');
const csvFile = `./data/winners-${stamp}.csv`;
writeFileSync(csvFile, csv);

// Winners markdown report
let md = `# Validated Winners — ${stamp}\n\n`;
md += `Source: ${file}\n\n`;
md += `- Shortlist rows: ${rows.length}\n`;
md += `- Fully validated by hand: ${validated.length}\n`;
md += `- **WINNERS (volume >50k AND 3+ DR<20 in top 10): ${winners.length}**\n\n`;
md += `Zero-click risk is shown for context only — it is a score penalty in the agent, not a winner criterion.\n\n`;
if (!winners.length) {
  md += `No winners yet. Fill in the check_volume_gt_50k and check_3x_dr_under_20 columns in the shortlist CSV with yes/no, then re-run.\n`;
} else {
  winners.forEach((r, i) => {
    md += `## ${i + 1}. ${r.keyword}\n\n`;
    md += `- Country: ${r.country}\n`;
    md += `- Language: ${r.language}\n`;
    md += `- Agent score: ${r.agent_score}/100\n`;
    md += `- Weak domains in top 10 (OPR proxy): ${r.weak_domains_top10}\n`;
    md += `- Zero-click risk: ${r.zero_click_risk || 'unknown'}\n`;
    md += `- Top URLs:\n${String(r.top_3_urls).split(' ').map((u) => `  - ${u}`).join('\n')}\n\n`;
  });
}
const mdFile = `./data/winners-${stamp}.md`;
writeFileSync(mdFile, md);

console.log(`Read: ${file}`);
console.log(`Rows: ${rows.length} | validated: ${validated.length} | WINNERS: ${winners.length}`);
if (winners.length) {
  console.log(`\nWinners:`);
  winners.forEach((r) => console.log(`  - ${r.keyword} (${r.country})`));
}
console.log(`\nReport: ${mdFile}\nCSV:    ${csvFile}`);
