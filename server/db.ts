import { neon } from '@neondatabase/serverless';

// Two database drivers share one interface:
//   - Node.js runtime (local dev, Docker, Render): node-postgres (`pg`) over TCP.
//   - Cloudflare Workers runtime: Neon serverless HTTP driver.
// The Neon HTTP driver cannot reach a plain Postgres server over TCP, so Node
// hosting must use `pg`. Workers cannot use `pg`, so it uses the Neon driver.

let sql: ReturnType<typeof neon> | null = null;
let pgPool: import('pg').Pool | null = null;

// Detect Cloudflare Workers environment (no Node runtime, or Workers globals present)
let isCloudflareEnv = false;
if (typeof globalThis !== 'undefined') {
  isCloudflareEnv =
    (typeof process === 'undefined' || !process.versions?.node) ||
    typeof (globalThis as any).WebSocketPair !== 'undefined';
}
const isNodeRuntime = !isCloudflareEnv;

// Embedded schema for Cloudflare Workers (injected at build time by prepare-cf-pages.js)
// @SCHEMA_SQL_PLACEHOLDER@
let EMBEDDED_SCHEMA: string | null = null;

function getConnectionString(): string {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }
  return connectionString;
}

export function getSQL() {
  if (!sql) {
    // Use Neon HTTP driver with fullResults for proper row metadata
    sql = neon(getConnectionString(), { fullResults: true });
  }
  return sql;
}

async function getPool(): Promise<import('pg').Pool> {
  if (!pgPool) {
    // Variable specifier keeps `pg` external to Workers bundlers (it is never
    // imported when running on Cloudflare, only under Node.js).
    const pgSpecifier = 'pg';
    const pg = (await import(/* @vite-ignore */ pgSpecifier)).default as typeof import('pg');
    pgPool = new pg.Pool({
      connectionString: getConnectionString(),
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pgPool;
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

async function loadSchemaText(): Promise<string> {
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

  return schemaText;
}

export async function ensureSchema(): Promise<void> {
  const schemaText = await loadSchemaText();

  if (isNodeRuntime) {
    // node-postgres runs the whole schema in one simple-query call; Postgres
    // parses `--` comments and multiple statements natively.
    const pool = await getPool();
    await pool.query(schemaText);
    return;
  }

  // Cloudflare Workers: Neon HTTP driver needs statements split manually.
  const db = getSQL();

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
  if (isNodeRuntime) {
    const pool = await getPool();
    const result = await pool.query(text, (params ?? []) as any[]);
    return {
      rows: result.rows as T[],
      rowCount: result.rowCount,
    };
  }

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
