/**
 * Cloudflare D1 database adapter for Seek&Track
 * Replaces Neon Postgres with SQLite-based D1
 */

/// <reference types="@cloudflare/workers-types" />

// Embedded schema for Cloudflare Workers (injected at build time)
// @SCHEMA_SQL_PLACEHOLDER@
let EMBEDDED_SCHEMA: string | null = null;

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number | null;
}

// Global D1 database binding (set by _worker.js on each request)
let globalDB: D1Database | null = null;

export function setD1Database(db: D1Database): void {
  globalDB = db;
}

export function getD1Database(): D1Database {
  if (!globalDB) {
    throw new Error('D1 database not initialized. Call setD1Database() first.');
  }
  return globalDB;
}

/**
 * Strip SQL line comments (-- ...) before splitting into statements.
 */
function stripSqlLineComments(sqlText: string): string {
  return sqlText
    .split('\n')
    .map((line) => {
      const commentIdx = line.indexOf('--');
      if (commentIdx >= 0) {
        return line.slice(0, commentIdx);
      }
      return line;
    })
    .join('\n');
}

export async function ensureSchema(): Promise<void> {
  const db = getD1Database();
  
  let schemaText: string | null = EMBEDDED_SCHEMA;
  
  // If schema not embedded (local dev), try reading from filesystem
  if (!schemaText && typeof process !== 'undefined' && process.versions?.node) {
    try {
      const { readFileSync } = await import('node:fs');
      const { dirname, join } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      
      const here = dirname(fileURLToPath(import.meta.url));
      const candidates = [
        join(here, 'schema-d1.sql'),
        join(here, '..', 'server', 'schema-d1.sql'),
        join(process.cwd(), 'server', 'schema-d1.sql'),
      ];
      
      for (const path of candidates) {
        try {
          schemaText = readFileSync(path, 'utf8');
          break;
        } catch {
          // try next
        }
      }
    } catch (err) {
      console.error('Failed to load schema from filesystem:', err);
    }
  }
  
  if (!schemaText) {
    throw new Error('Could not find schema-d1.sql (not embedded and filesystem unavailable)');
  }
  
  // Strip line comments before splitting
  const cleaned = stripSqlLineComments(schemaText);
  
  // Split into individual statements
  const statements = cleaned
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  
  // Execute all DDL statements in D1 batch (max 50 per batch)
  const batchSize = 50;
  for (let i = 0; i < statements.length; i += batchSize) {
    const batch = statements.slice(i, i + batchSize).map((stmt) => db.prepare(stmt));
    await db.batch(batch);
  }
}

/**
 * Normalize a bound parameter for D1 (D1 rejects undefined, Date and other objects).
 */
function normalizeParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value !== null && typeof value === 'object' && !(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Convert Postgres-flavoured SQL used by the app into SQLite/D1 SQL.
 *
 * - `= ANY($N)` / `= ANY($N::text[])` -> `IN (SELECT value FROM json_each(?N))` with the array
 *   bound as ONE JSON param. Parameter numbering is preserved (no flattening/renumbering) and
 *   arbitrarily large arrays never hit D1's 100-bound-parameter limit.
 * - `$N` -> `?N` (D1 supports ordered ?NNN params)
 * - `NOW()` -> ISO-8601 UTC text, same format as JS toISOString() and the imported data
 * - Postgres `::type` casts are stripped; `jsonb_set(` -> `json_set(`
 */
export function convertQueryForD1(
  sql: string,
  params: unknown[]
): { sql: string; params: unknown[] } {
  const convertedParams = params.map(normalizeParam);
  const anyIndexes = new Set<number>();

  let convertedSql = sql.replace(
    /=\s*ANY\s*\(\s*\$(\d+)(?:\s*::\s*[a-z_ ]+(?:\[\])?)?\s*\)/gi,
    (_m, n: string) => {
      anyIndexes.add(Number(n) - 1);
      return `IN (SELECT value FROM json_each(?${n}))`;
    }
  );
  for (const idx of anyIndexes) {
    const raw = params[idx];
    const arr = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
    convertedParams[idx] = JSON.stringify(arr.map((v) => (v instanceof Date ? v.toISOString() : v)));
  }

  convertedSql = convertedSql
    .replace(/\$(\d+)/g, '?$1')
    .replace(/\bNOW\(\)/gi, "strftime('%Y-%m-%dT%H:%M:%fZ','now')")
    .replace(/::\s*(jsonb|json|text\[\]|text|int4|int8|int|integer|bigint|numeric|float8|double precision|real|timestamptz|timestamp|date|boolean)(?![a-z_0-9])/gi, '')
    .replace(/jsonb_set\(/gi, 'json_set(');

  return { sql: convertedSql, params: convertedParams };
}

/**
 * Query helper with parameterized queries
 */
export async function query<T = any>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const db = getD1Database();
  
  const { sql: convertedSql, params: convertedParams } = convertQueryForD1(
    text,
    params ?? []
  );

  const stmt = db.prepare(convertedSql).bind(...convertedParams);
  const result = await stmt.all<T>();

  return {
    rows: result.results ?? [],
    rowCount: result.meta?.changes ?? result.results?.length ?? 0,
  };
}

/**
 * Execute a single statement and return meta info
 */
export async function execute(
  text: string,
  params?: unknown[]
): Promise<{ rowCount: number }> {
  const db = getD1Database();
  
  const { sql: convertedSql, params: convertedParams } = convertQueryForD1(
    text,
    params ?? []
  );

  const stmt = db.prepare(convertedSql).bind(...convertedParams);
  const result = await stmt.run();

  return {
    rowCount: result.meta?.changes ?? 0,
  };
}

/**
 * Batch execute multiple statements atomically
 * D1 allows max 50 statements per batch
 */
export async function batch(
  statements: Array<{ text: string; params?: unknown[] }>
): Promise<void> {
  const db = getD1Database();
  
  // Convert all statements
  const converted = statements.map(({ text, params }) =>
    convertQueryForD1(text, params ?? [])
  );

  // Execute in chunks of 50 (D1 limit)
  const batchSize = 50;
  for (let i = 0; i < converted.length; i += batchSize) {
    const chunk = converted.slice(i, i + batchSize);
    const preparedStatements = chunk.map(({ sql, params }) =>
      db.prepare(sql).bind(...params)
    );
    await db.batch(preparedStatements);
  }
}

/**
 * Transaction helper - uses D1 batch for atomicity
 */
export async function transaction<T>(
  statements: Array<{ text: string; params?: unknown[] }>
): Promise<void> {
  await batch(statements);
}
