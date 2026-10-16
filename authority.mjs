// Domain authority lookup via OpenPageRank (Keywords Everywhere platform).
// Docs: https://openpagerank.keywordseverywhere.com/docs
// OPR scores 0-10 from its own web index — NOT Ahrefs DR, but low OPR ≈ low authority.
// Used as the automatable proxy for your "3+ sites under DR 20 in top 10" rule.
// Finalists still get a true DR check in your SEO tool (Semrush / Ahrefs) by hand.
//
// Auth:  Authorization: Bearer <OPR API key>
//        (create the key on the OPR dashboard after signing in with a free
//         Keywords Everywhere key — legacy domcop.com keys do NOT work here)
import axios from 'axios';
import { config } from './config.mjs';
import { sleep, domainOf } from './util.mjs';

const OPR_BASE = 'https://openpagerank.keywordseverywhere.com';

// Parse a /v1/domains/bulk response into { queriedHostname: score|null }.
// Handles platform subdomains (e.g. xxx.blogspot.com) served as host entries.
export function parseOprResponse(data, queried) {
  const scoreByHost = {};
  for (const r of data.results || []) {
    if (r.domain) scoreByHost[String(r.domain).toLowerCase()] = numOrNull(r.open_page_rank);
    for (const h of r.hosts || []) {
      scoreByHost[String(h.host).toLowerCase()] = numOrNull(h.open_page_rank);
    }
  }
  const out = {};
  for (const d of queried) out[d] = scoreByHost[String(d).toLowerCase()] ?? null;
  return out;
}

function numOrNull(v) {
  return typeof v === 'number' ? Math.round(v * 100) / 100 : null;
}

export async function fetchAuthority(domains) {
  const out = {};
  const uniq = [...new Set((domains || []).map((d) => String(d).toLowerCase()))].filter(Boolean);
  if (!uniq.length) return out;
  if (!config.openpagerankKey) {
    console.log('  (no OPENPAGERANK_API_KEY — skipping authority check)');
    return out;
  }
  for (let i = 0; i < uniq.length; i += 100) {
    const batch = uniq.slice(i, i + 100);
    try {
      const { data, headers } = await axios.post(
        `${OPR_BASE}/v1/domains/bulk`,
        { domains: batch, include_history: false },
        {
          headers: {
            Authorization: `Bearer ${config.openpagerankKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );
      Object.assign(out, parseOprResponse(data, batch));
      if (headers['x-domains-remaining'] !== undefined) {
        console.log(`  OPR quota: ${headers['x-domains-remaining']} domains remaining this month`);
      }
    } catch (e) {
      const detail = e.response?.data?.error?.message || e.message;
      console.error(`  OpenPageRank batch failed: ${detail}`);
    }
    await sleep(1000);
  }
  return out;
}

// Counts top-10 domains at/below the low-authority line and awards the bonus.
// Pure function — easy to test, no network.
export function applyAuthorityBonus(opportunity, authorityMap, cfg) {
  const scored = (opportunity.topResults || []).slice(0, 10).map((r) => {
    const d = domainOf(r.url);
    return { domain: d, opr: authorityMap[d] ?? null };
  });
  const low = scored.filter((s) => s.opr !== null && s.opr <= cfg.lowAuthorityThreshold);
  if (low.length >= cfg.lowAuthorityMinCount) {
    return {
      bonus: cfg.authorityBonus,
      lowCount: low.length,
      scored,
      signal: `${low.length}/10 top domains have very low authority (OPR ≤ ${cfg.lowAuthorityThreshold}, DR<20 proxy): ${low
        .map((s) => s.domain)
        .join(', ')}`,
    };
  }
  return { bonus: 0, lowCount: low.length, scored, signal: null };
}
