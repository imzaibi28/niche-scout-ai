// Report generator: markdown report + opportunity DB (JSON) + CSV + Ahrefs shortlist.
import { mkdirSync, writeFileSync } from 'fs';
import { domainOf } from './util.mjs';

function escCsv(v) {
  const s = String(v ?? '').replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

function authorityLine(o) {
  if (!o.domainAuthority || !o.domainAuthority.length) return 'not checked';
  return o.domainAuthority.map((d) => `${d.domain} (${d.opr === null ? '?' : d.opr})`).join(', ');
}

function volumeLine(o) {
  if (!o.volume || o.volume.value === null) return 'unknown (KWscanner lookup failed or not run)';
  const v = o.volume.value.toLocaleString();
  return `${v}/mo (${o.volume.country}) — ${o.volumePass ? 'PASS' : 'FAIL'} vs ${'50,000'}/mo filter`;
}

function volumeShort(o) {
  if (!o.volume || o.volume.value === null) return '';
  return o.volume.value.toLocaleString();
}

function youngLine(o) {
  if (o.youngDomainCount === undefined) return 'not checked';
  const ages = (o.domainAges || [])
    .filter((d) => d.ageDays !== null)
    .map((d) => `${d.domain} (${d.ageDays}d)`)
    .join(', ');
  return `${o.youngDomainCount} under 1yr${ages ? ` — ${ages}` : ''}`;
}

function zeroClickLine(o) {
  const z = o.zeroClick;
  if (!z) return 'not checked';
  const base = `${z.risk}${z.penalty ? ` (−${z.penalty} pts)` : ''}`;
  const detail = (z.reasons && z.reasons.length ? z.reasons.join('; ') : z.note) || '';
  return detail ? `${base} — ${detail}` : base;
}

export function writeOutputs(opportunities, dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);

  // 1. Opportunity DB (JSON)
  const dbFile = `${dataDir}/opportunities-${stamp}.json`;
  writeFileSync(dbFile, JSON.stringify(opportunities, null, 2));

  // 2. CSV (opens in Excel)
  const cols = ['country', 'language', 'category', 'program', 'score', 'low_authority_count', 'young_domains_top10', 'kwscanner_volume', 'kwscanner_cpc', 'volume_pass', 'zero_click_risk', 'zero_click_penalty', 'seed_query', 'signals', 'top_domains_opr', 'cluster_size', 'source_urls'];
  const rows = opportunities.map((o) =>
    [
      o.country,
      o.language,
      o.category || '',
      o.program,
      o.score,
      o.lowAuthorityCount ?? '',
      o.youngDomainCount ?? '',
      volumeShort(o),
      o.volume?.cpc ?? '',
      o.volumePass === undefined ? '' : (o.volumePass ? 'yes' : 'no'),
      o.zeroClick?.risk ?? '',
      o.zeroClick?.penalty ?? '',
      o.query,
      o.signals.join(' | '),
      authorityLine(o),
      o.cluster.length,
      (o.topResults || []).slice(0, 5).map((r) => r.url).join(' '),
    ]
      .map(escCsv)
      .join(',')
  );
  const csvFile = `${dataDir}/opportunities-${stamp}.csv`;
  writeFileSync(csvFile, cols.join(',') + '\n' + rows.join('\n'));

  // 3. Validation shortlist — KWscanner volume is pre-filled; true DR still needs
  // your manual check in your SEO tool. Only volume-passing (or volume-unknown)
  // keywords make the shortlist; below-filter keywords stay in the report/CSV only.
  const shortlisted = [...opportunities]
    .filter((o) => o.volumePass !== false)
    .sort(
      (a, b) =>
        (b.volumePass === true) - (a.volumePass === true) ||
        (b.lowAuthorityCount ?? 0) - (a.lowAuthorityCount ?? 0) ||
        b.score - a.score
    );
  const sCols = ['keyword', 'country', 'language', 'agent_score', 'weak_domains_top10', 'young_domains_top10', 'kwscanner_volume', 'kwscanner_cpc', 'zero_click_risk', 'check_volume_gt_50k', 'check_3x_dr_under_20', 'check_2x_domains_under_1yr', 'top_3_urls'];
  const sRows = shortlisted.map((o) =>
    [
      o.query,
      o.country,
      o.language,
      o.score,
      o.lowAuthorityCount ?? '',
      o.youngDomainCount ?? '',
      volumeShort(o),
      o.volume?.cpc ?? '',
      o.zeroClick?.risk ?? '',
      '',
      '',
      '',
      (o.topResults || []).slice(0, 3).map((r) => r.url).join(' '),
    ]
      .map(escCsv)
      .join(',')
  );
  const shortlistFile = `${dataDir}/ahrefs-shortlist-${stamp}.csv`;
  writeFileSync(shortlistFile, sCols.join(',') + '\n' + sRows.join('\n'));

  // 4. Markdown report in the required format
  let md = `# Niche Opportunities — ${stamp}\n\n${opportunities.length} opportunities scored at/above threshold. All evidence observed; no metrics invented.\n`;
  md += `Volume shown is KWscanner (Google Keyword Planner-sourced, Global market) where the volume step ran; true Ahrefs DR must still be validated by hand — see ${shortlistFile.split('/').pop()}.\n\n`;
  opportunities.forEach((o, i) => {
    const domains = [...new Set((o.topResults || []).map((r) => domainOf(r.url)))];
    md += `## ${i + 1}. ${o.program} — ${o.country} (score ${o.score}/100)\n\n`;
    md += `- Country: ${o.country}\n`;
    md += `- Language: ${o.language}\n`;
    md += `- Category: ${o.category || 'govt-program'}\n`;
    md += `- Program/topic: ${o.program}\n`;
    md += `- Primary search intent: ${o.query}\n`;
    md += `- Example queries: ${o.cluster.map((c) => c.query).join('; ')}\n`;
    md += `- Related query cluster: ${o.cluster.length} queries checked\n`;
    if (o.longtails?.length) {
      const shown = o.longtails.slice(0, 15).join('; ');
      const more = o.longtails.length > 15 ? ` (+${o.longtails.length - 15} more)` : '';
      md += `- Long-tail queries (Google Autocomplete, unscored): ${shown}${more}\n`;
    }
    md += `- Existing ranking websites: ${domains.join(', ') || 'none observed'}\n`;
    md += `- Domain authority (OpenPageRank 0-10, DR<20 proxy): ${authorityLine(o)}\n`;
    md += `- Weak domains in top 10: ${o.lowAuthorityCount ?? 'not checked'}\n`;
    md += `- Domains under 1 year old in top 10: ${youngLine(o)}\n`;
    md += `- Monthly volume: ${volumeLine(o)}\n`;
    if (o.serperCheck) {
      const s = o.serperCheck;
      md += `- Serper local SERP (${s.gl}): ${s.weakCount}/${s.total} weak domains — ${s.note}\n`;
    }
    if (o.seasonality) {
      const t = o.seasonality;
      md += `- Seasonality (Google Trends, 12mo, ${t.geo}): ${t.label} — ${t.note}\n`;
    }
    md += `- Zero-click risk (SERP features): ${zeroClickLine(o)}\n`;
    md += `- Evidence of weak competition: ${o.signals.join('; ')}\n`;
    if (o.contentBrief) {
      const b = o.contentBrief;
      md += `- Content brief (${b.pagesAnalyzed}/${b.pagesAttempted} top pages analyzed): ${b.verdict}\n`;
      if (b.mustCoverTopics.length) {
        md += `- Must-cover subtopics: ${b.mustCoverTopics.map((t) => `${t.topic} (${t.pages}/${b.pagesAnalyzed})`).join('; ')}\n`;
      }
    }
    md += `- Why the niche is expandable: cluster of ${o.cluster.length} utility queries around one program — each maps to a page\n`;
    md += `- Potential monetization: display ads (high-repeat informational utility traffic)\n`;
    md += `- Source URLs:\n${(o.topResults || []).slice(0, 5).map((r) => `  - ${r.url}`).join('\n')}\n\n`;
  });
  const mdFile = `${dataDir}/report-${stamp}.md`;
  writeFileSync(mdFile, md);

  return { dbFile, csvFile, mdFile, shortlistFile };
}
