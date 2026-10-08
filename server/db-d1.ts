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
 * Convert PostgreSQL $N placeholders to D1 ?N style and handle ANY() expansion
 */
function convertQueryForD1(
  sql: string,
  params: unknown[]
): { sql: string; params: unknown[] } {
  let convertedSql = sql;
  let convertedParams = [...params];

  // Handle ANY($N) array queries - convert to IN (?, ?, ...)
  // Match patterns like "= ANY($1)" or "= ANY($1::text[])"
  const anyRegex = /=\s*ANY\(\$(\d+)(?:::[a-z\[\]]+)?\)/gi;
  let match: RegExpExecArray | null;
  let offset = 0;
  const replacements: Array<{ start: number; end: number; paramIndex: number }> = [];

  // First pass: collect all ANY() matches
  while ((match = anyRegex.exec(sql)) !== null) {
    const paramIndex = parseInt(match[1], 10) - 1;
    replacements.push({
      start: match.index,
      end: match.index + match[0].length,
      paramIndex,
    });
  }

  // Process replacements in reverse order to maintain correct indices
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { start, end, paramIndex } = replacements[i];
    const arrayParam = params[paramIndex];

    if (Array.isArray(arrayParam) && arrayParam.length > 0) {
      const placeholders = arrayParam.map(() => '?').join(', ');
      const inClause = `IN (${placeholders})`;
      
      convertedSql = convertedSql.slice(0, start + 2) + inClause + convertedSql.slice(end);
      
      // Flatten the array into params list
      convertedParams = [
        ...convertedParams.slice(0, paramIndex),
        ...arrayParam,
        ...convertedParams.slice(paramIndex + 1),
      ];
    } else if (Array.isArray(arrayParam) && arrayParam.length === 0) {
      // Empty array - use IN (NULL) to match nothing
      convertedSql = convertedSql.slice(0, start + 2) + 'IN (NULL)' + convertedSql.slice(end);
      convertedParams = [
        ...convertedParams.slice(0, paramIndex),
        ...convertedParams.slice(paramIndex + 1),
      ];
    }
  }

  // Convert remaining $N to ?N (for non-ANY params)
  convertedSql = convertedSql.replace(/\$(\d+)/g, '?$1');

  // Remove Postgres-specific type casts
  convertedSql = convertedSql.replace(/::(jsonb|text\[\]|int|double precision|timestamptz)/gi, '');

  // Convert jsonb_set to json_set for SQLite
  convertedSql = convertedSql.replace(/jsonb_set\(/gi, 'json_set(');

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
