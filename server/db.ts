/**
 * Database adapter - automatically uses D1 or Neon based on environment
 * 
 * When D1 is bound (env.DB set): uses D1
 * When DATABASE_URL is set: uses Neon (local dev fallback)
 * 
 * All server code imports from './db.js' and gets the right adapter automatically
 */

/// <reference types="@cloudflare/workers-types" />

// Check if D1 is available (set by _worker.js or dev environment)
let useD1 = false;
let d1Adapter: any = null;

// Try to import D1 adapter (will fail if not available, which is fine)
try {
  d1Adapter = await import('./db-d1.js');
  // Check if D1 is actually initialized
  try {
    d1Adapter.getD1Database();
    useD1 = true;
    console.log('[DB] Using Cloudflare D1 adapter');
  } catch {
    // D1 not initialized yet, will check again on first query
  }
} catch {
  // D1 adapter not available (e.g., local dev without D1)
}

// Lazy-load Neon adapter only if needed
let neonAdapter: any = null;

async function getNeonAdapter() {
  if (!neonAdapter) {
    neonAdapter = await import('./db-neon.js');
  }
  return neonAdapter;
}

// Re-export D1 setters for _worker.js
export function setD1Database(db: D1Database): void {
  if (d1Adapter) {
    d1Adapter.setD1Database(db);
    if (!useD1) console.log('[DB] D1 database bound, using D1 adapter');
    useD1 = true;
  }
}

import { cached, noteWriteSql, writtenTables } from './isolate-cache.js';

/**
 * Hot single-table reads served from the per-isolate cache (D1 row-read budget). Matched on the
 * whitespace-normalized SQL; the cache key includes the params. Any write to the table in this
 * isolate invalidates (see noteWriteSql); the TTL bounds staleness from writes in OTHER isolates.
 */
export const READ_CACHE_RULES: ReadonlyArray<{ re: RegExp; ttlMs: number; name: string }> = [
  { name: 'settings', re: /^SELECT data FROM (settings) WHERE id = 1$/i, ttlMs: 30_000 },
  { name: 'pair_cache', re: /^SELECT [^;]*? FROM (pair_cache)\b(?![^;]*\b(?:JOIN|UNION)\b)/i, ttlMs: 30_000 },
  { name: 'research_universe', re: /^SELECT \* FROM (research_universe) ORDER BY /i, ttlMs: 30_000 },
  { name: 'research_etf_map', re: /^SELECT [^;]*? FROM (research_etf_map)\b(?![^;]*\b(?:JOIN|UNION)\b)/i, ttlMs: 30_000 },
  // Trades: until a write in this isolate, 5 min safety net across isolates (?fresh=1 bypasses).
  { name: 'trades', re: /^SELECT \* FROM (trades) ORDER BY /i, ttlMs: 5 * 60_000 },
  // Paper / crypto-paper / paper-flex summaries.
  {
    name: 'paper',
    re: /^SELECT \* FROM ((?:crypto_)?paper(?:_flex)?_(?:state|positions|orders|journal))\b(?![^;]*\b(?:JOIN|UNION)\b)/i,
    ttlMs: 60_000,
  },
];

/** Pure: the cache rule (and table) for a read statement, or null. Exported for tests. */
export function readCacheRuleFor(text: string): { ttlMs: number; table: string } | null {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (writtenTables(sql).length > 0) return null;
  if (/\b(?:JOIN|UNION)\b/i.test(sql)) return null; // single-table reads only
  for (const r of READ_CACHE_RULES) {
    const m = r.re.exec(sql);
    if (m) return { ttlMs: r.ttlMs, table: m[1].toLowerCase() };
  }
  return null;
}

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number | null;
}

export async function ensureSchema(): Promise<void> {
  if (useD1 && d1Adapter) {
    return d1Adapter.ensureSchema();
  }
  
  // Try D1 one more time (might have been initialized since import)
  if (d1Adapter) {
    try {
      d1Adapter.getD1Database();
      useD1 = true;
      return d1Adapter.ensureSchema();
    } catch {
      // Fall through to Neon
    }
  }
  
  const neon = await getNeonAdapter();
  return neon.ensureSchema();
}

/**
 * Writes in this isolate invalidate dependent read caches, both before the statement runs and
 * after it completes (so a read that started in between can't cache pre-write data).
 */
async function withWriteInvalidation<R>(texts: string[], run: () => Promise<R>): Promise<R> {
  for (const t of texts) noteWriteSql(t);
  try {
    return await run();
  } finally {
    for (const t of texts) noteWriteSql(t);
  }
}

export async function query<T = any>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const rule = readCacheRuleFor(text);
  if (rule) {
    const key = `sql:${text.replace(/\s+/g, ' ').trim()}|${JSON.stringify(params ?? [])}`;
    const res = await cached(key, { ttlMs: rule.ttlMs, tables: [rule.table] }, () => queryInner<T>(text, params));
    return { rows: [...res.rows], rowCount: res.rowCount };
  }
  return withWriteInvalidation([text], () => queryInner<T>(text, params));
}

async function queryInner<T = any>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  if (useD1 && d1Adapter) {
    return d1Adapter.query(text, params) as Promise<QueryResult<T>>;
  }
  
  // Try D1 one more time
  if (d1Adapter) {
    try {
      d1Adapter.getD1Database();
      useD1 = true;
      return d1Adapter.query(text, params) as Promise<QueryResult<T>>;
    } catch {
      // Fall through to Neon
    }
  }
  
  const neon = await getNeonAdapter();
  return neon.query(text, params) as Promise<QueryResult<T>>;
}

export async function execute(
  text: string,
  params?: unknown[]
): Promise<{ rowCount: number }> {
  return withWriteInvalidation([text], () => executeInner(text, params));
}

async function executeInner(
  text: string,
  params?: unknown[]
): Promise<{ rowCount: number }> {
  if (useD1 && d1Adapter) {
    return d1Adapter.execute(text, params) as Promise<{ rowCount: number }>;
  }
  
  // Try D1 one more time
  if (d1Adapter) {
    try {
      d1Adapter.getD1Database();
      useD1 = true;
      return d1Adapter.execute(text, params) as Promise<{ rowCount: number }>;
    } catch {
      // Fall through to Neon
    }
  }
  
  const neon = await getNeonAdapter();
  // Neon adapter doesn't have separate execute, use query
  const result = await neon.query(text, params);
  return { rowCount: result.rowCount ?? 0 };
}

export async function batch(
  statements: Array<{ text: string; params?: unknown[] }>
): Promise<void> {
  return withWriteInvalidation(statements.map((s) => s.text), () => batchInner(statements));
}

async function batchInner(
  statements: Array<{ text: string; params?: unknown[] }>
): Promise<void> {
  if (useD1 && d1Adapter) {
    return d1Adapter.batch(statements);
  }
  
  // Try D1 one more time
  if (d1Adapter) {
    try {
      d1Adapter.getD1Database();
      useD1 = true;
      return d1Adapter.batch(statements);
    } catch {
      // Fall through to Neon
    }
  }
  
  const neon = await getNeonAdapter();
  // Neon doesn't have batch, execute sequentially
  for (const stmt of statements) {
    await neon.query(stmt.text, stmt.params);
  }
}

export async function transaction<T>(
  statements: Array<{ text: string; params?: unknown[] }>
): Promise<void> {
  return batch(statements);
}
