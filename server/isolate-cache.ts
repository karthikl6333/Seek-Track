/**
 * Per-isolate in-memory read cache (D1 row-read budget).
 *
 * Each Worker isolate keeps its own copy; there is no cross-isolate coherence, so every entry has
 * a short TTL. Writes made IN THIS ISOLATE invalidate dependent entries immediately: db.ts calls
 * noteWriteSql() for every statement, which extracts the written table(s) and drops all entries
 * that declared a dependency on them. A load that was in flight when an invalidation happened is
 * returned to its caller but NOT stored (generation check), so a stale read can't be cached.
 */

import { isCacheBypassed } from './read-budget.js';

interface Entry {
  value?: unknown;
  expires: number;
  tables: readonly string[];
  inflight?: Promise<unknown>;
  gen: number;
}

const entries = new Map<string, Entry>();
let generation = 0;
let clock: () => number = () => Date.now();

const stats = { hits: 0, misses: 0, invalidations: 0 };

export interface CacheOptions {
  ttlMs: number;
  /** Tables this value is derived from; a write to any of them in this isolate drops the entry. */
  tables: readonly string[];
}

export async function cached<T>(key: string, opts: CacheOptions, loader: () => Promise<T>): Promise<T> {
  const now = clock();
  const hit = isCacheBypassed() ? undefined : entries.get(key);
  if (hit && 'value' in hit && hit.expires > now) {
    stats.hits++;
    return hit.value as T;
  }
  if (hit?.inflight) {
    stats.hits++;
    return hit.inflight as Promise<T>;
  }
  stats.misses++;
  const gen = ++generation;
  const tables = opts.tables.map((t) => t.toLowerCase());
  const inflight = loader().then(
    (value) => {
      const cur = entries.get(key);
      // Only store if nothing invalidated / replaced this entry while loading.
      if (cur && cur.gen === gen) entries.set(key, { value, expires: clock() + opts.ttlMs, tables, gen });
      return value;
    },
    (err) => {
      const cur = entries.get(key);
      if (cur && cur.gen === gen) entries.delete(key);
      throw err;
    },
  );
  entries.set(key, { expires: 0, tables, inflight, gen });
  return inflight;
}

/** Drop every entry that depends on any of `tables`. */
export function invalidateTables(tables: readonly string[]): void {
  if (tables.length === 0) return;
  const set = new Set(tables.map((t) => t.toLowerCase()));
  for (const [key, e] of entries) {
    if (e.tables.some((t) => set.has(t))) {
      entries.delete(key);
      stats.invalidations++;
    }
  }
}

/** Drop entries by exact key or key prefix (e.g. 'research:'). */
export function invalidateKeys(prefix: string): void {
  for (const key of entries.keys()) if (key === prefix || key.startsWith(prefix)) entries.delete(key);
}

const WRITE_RE = /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+["`]?([A-Za-z_][A-Za-z0-9_]*)/gi;

/** Tables written by a SQL statement (empty for pure reads). */
export function writtenTables(sql: string): string[] {
  const out = new Set<string>();
  for (const m of sql.matchAll(WRITE_RE)) out.add(m[1].toLowerCase());
  // DDL (schema migration) invalidates everything.
  if (/\b(?:CREATE|DROP|ALTER)\s+(?:TABLE|INDEX)/i.test(sql)) out.add('*');
  return Array.from(out);
}

/** Called by db.ts for every statement it runs. */
export function noteWriteSql(sql: string): void {
  const tables = writtenTables(sql);
  if (tables.length === 0) return;
  if (tables.includes('*')) {
    entries.clear();
    return;
  }
  invalidateTables(tables);
}

export function cacheStats() {
  return { ...stats, size: entries.size };
}

// ---- test hooks ----
export function __resetIsolateCacheForTests(): void {
  entries.clear();
  stats.hits = stats.misses = stats.invalidations = 0;
  clock = () => Date.now();
}
export function __setCacheClockForTests(fn: () => number): void {
  clock = fn;
}
