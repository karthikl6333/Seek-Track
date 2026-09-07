import { neon } from '@neondatabase/serverless';

// Use Neon HTTP driver for Cloudflare Workers compatibility
// HTTP driver works everywhere: Workers and Node.js

let sql: ReturnType<typeof neon> | null = null;
let isCloudflareEnv = false;

// Detect Cloudflare Workers environment
if (typeof globalThis !== 'undefined') {
  // Cloudflare Workers have WebSockets built-in or through cf-socket-polyfill
  isCloudflareEnv = 
    (typeof process === 'undefined' || !process.versions?.node) ||
    typeof (globalThis as any).WebSocketPair !== 'undefined';
}

// Embedded schema for Cloudflare Workers (injected at build time by prepare-cf-pages.js)
// @SCHEMA_SQL_PLACEHOLDER@
let EMBEDDED_SCHEMA: string | null = null;

export function getSQL() {
  if (!sql) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required');
    }

    // Use Neon HTTP driver with fullResults for proper row metadata
    sql = neon(connectionString, { fullResults: true });
  }
  return sql;
}

/**
 * Strip SQL line comments (-- ...) before splitting into statements.
 * Prevents false semicolon splits on commented semicolons like "Research; never re-seed"
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
      // Dynamic imports for Node-only modules (won't be in Workers bundle)
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
  
  // CRITICAL: Strip line comments BEFORE splitting to avoid false splits on "Research; never..."
  const cleaned = stripSqlLineComments(schemaText);
  
  // Split into individual statements (naive semicolon split works AFTER comment stripping)
  const statements = cleaned
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  
  // Execute all DDL statements in ONE transaction (required for Neon HTTP driver)
  // Use sql.query() for raw SQL strings within transaction
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
  // Use .query() method for parameterized queries with $1, $2 placeholders
  const result = await db.query(text, params ?? []);
  // Neon HTTP driver with fullResults returns { rows, rowCount, fields, ... }
  // Type assertion needed because result type is union
  const fullResult = result as { rows: T[]; rowCount: number };
  return {
    rows: fullResult.rows,
    rowCount: fullResult.rowCount,
  };
}
