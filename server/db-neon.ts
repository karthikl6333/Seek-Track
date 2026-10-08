/**
 * Neon Postgres database adapter (legacy/local dev fallback)
 * Used when DATABASE_URL is set but D1 is not available
 */

import { neon } from '@neondatabase/serverless';

let sql: ReturnType<typeof neon> | null = null;

// Embedded schema for fallback (injected at build time)
// @SCHEMA_SQL_PLACEHOLDER@
let EMBEDDED_SCHEMA: string | null = null;

export function getSQL() {
  if (!sql) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for Neon adapter');
    }

    // Use Neon HTTP driver with fullResults for proper row metadata
    sql = neon(connectionString, { fullResults: true });
  }
  return sql;
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
  const db = getSQL();
  
  let schemaText: string | null = EMBEDDED_SCHEMA;
  
  // If schema not embedded (local dev), try reading from filesystem
  if (!schemaText && typeof process !== 'undefined' && process.versions?.node) {
    try {
      const { readFileSync } = await import('node:fs');
      const { dirname, join } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      
      const here = dirname(fileURLToPath(import.meta.url));
      const candidates = [
        join(here, 'schema.sql'),
        join(here, '..', 'server', 'schema.sql'),
        join(process.cwd(), 'server', 'schema.sql'),
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
    throw new Error('Could not find schema.sql (not embedded and filesystem unavailable)');
  }
  
  const cleaned = stripSqlLineComments(schemaText);
  
  const statements = cleaned
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  
  // Execute all DDL statements in ONE transaction
  const queries = statements.map((stmt) => db.query(stmt, []));
  await db.transaction(queries);
}

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number | null;
}

export async function query<T = any>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const db = getSQL();
  const result = await db.query(text, params ?? []);
  const fullResult = result as { rows: T[]; rowCount: number };
  return {
    rows: fullResult.rows,
    rowCount: fullResult.rowCount,
  };
}
