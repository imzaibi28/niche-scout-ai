// File cache — never pay twice for the same query. Zero dependencies.
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CACHE_DIR = './data/cache';
mkdirSync(CACHE_DIR, { recursive: true });

const keyFor = (query) => createHash('sha256').update(query).digest('hex') + '.json';

export function cacheGet(query) {
  const f = join(CACHE_DIR, keyFor(query));
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

export function cacheSet(query, payload) {
  writeFileSync(
    join(CACHE_DIR, keyFor(query)),
    JSON.stringify({ query, fetchedAt: new Date().toISOString(), payload }, null, 2)
  );
}
