/**
 * Neon Postgres database adapter (legacy/local dev fallback)
 * Used when DATABASE_URL is set but D1 is not available
 */

import { neon } from '@neondatabase/serverless';

let sql: ReturnType<typeof neon> | null = null;

/**
 * Schema version - increment when schema changes. ensureSchema re-runs the (idempotent:
 * CREATE ... IF NOT EXISTS) schema once per DB when the stored version differs.
 * v2: read-budget indexes (marks.updated_at, price_alerts(status, symbol), pair_cache.underlying).
 * v3: Plan vs Price card (plan_rules, plan_rule_notifications tables).
 */
export const SCHEMA_VERSION = 3;

// Per-process flag: once schema is verified in this process, skip rechecks
let schemaInitialized = false;

/** Test hook: forget the per-process "schema verified" flag. */
export function __resetSchemaStateForTests(): void {
  schemaInitialized = false;
}

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
  // Fast path: if already initialized in this process, skip
  if (schemaInitialized) {
    return;
  }

  const db = getSQL();
  
  // Check if schema is already at the current version (cheap read)
  try {
    const versionResult = await db('SELECT version FROM schema_meta WHERE id = 1', []);
    const currentVersion = versionResult.rows?.[0]?.version as number | undefined;
    
    if (currentVersion === SCHEMA_VERSION) {
      schemaInitialized = true;
      return;
    }
    
    console.log(`[Neon] Schema version mismatch: DB=${currentVersion ?? 'none'}, code=${SCHEMA_VERSION}. Running migration...`);
  } catch (err) {
    // schema_meta table doesn't exist yet, proceed with full schema init
    console.log('[Neon] schema_meta not found, initializing schema...');
  }
  
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

  // Record schema version
  await db('CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)', []);
  await db('INSERT INTO schema_meta (id, version) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version', [1, SCHEMA_VERSION]);
  
  schemaInitialized = true;
  console.log(`[Neon] Schema initialized to version ${SCHEMA_VERSION}`);

  // Seed initial plan rules (idempotent - won't duplicate)
  try {
    const { seedPlanRules } = await import('./seed-plan-rules.js');
    const result = await seedPlanRules();
    if (result.added > 0) {
      console.log(`[Neon] Seeded ${result.added} plan rules`);
    }
  } catch (err) {
    console.error('[Neon] Failed to seed plan rules:', err);
  }
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
