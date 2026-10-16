// Cluster expansion: sibling queries for each opportunity.
// Scores the CLUSTER, never the single keyword.
import { tavilySearch } from './tavily.mjs';
import { cacheGet, cacheSet } from './cache.mjs';
import { sleep } from './util.mjs';
import { config } from './config.mjs';

const CLUSTER_TEMPLATES = [
  '{p} eligibility requirements',
  '{p} documents required',
  '{p} payment dates',
  '{p} how to apply online',
  '{p} status check',
  '{p} appeal process',
];

export function buildClusterQueries(program) {
  return CLUSTER_TEMPLATES.map((t) => t.replaceAll('{p}', program));
}

export async function expandCluster(program, onQuery) {
  const cluster = [];
  for (const q of buildClusterQueries(program)) {
    const hit = cacheGet(q);
    let payload;
    if (hit) {
      payload = hit.payload;
    } else {
      await sleep(config.delayMs);
      payload = await tavilySearch(q);
      cacheSet(q, payload);
    }
    if (onQuery) onQuery(q);
    cluster.push({
      query: q,
      resultCount: payload.results?.length ?? 0,
      topUrls: (payload.results ?? []).slice(0, 5).map((r) => r.url),
    });
  }
  return cluster;
}
