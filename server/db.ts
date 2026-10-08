/**
 * Database adapter - automatically uses D1 or Neon based on environment
 * 
 * When D1 is bound (env.DB set): uses D1
 * When DATABASE_URL is set: uses Neon (local dev fallback)
 * 
 * All server code imports from './db.js' and gets the right adapter automatically
 */

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
    useD1 = true;
    console.log('[DB] D1 database bound, using D1 adapter');
  }
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

export async function query<T = any>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  if (useD1 && d1Adapter) {
    return d1Adapter.query<T>(text, params);
  }
  
  // Try D1 one more time
  if (d1Adapter) {
    try {
      d1Adapter.getD1Database();
      useD1 = true;
      return d1Adapter.query<T>(text, params);
    } catch {
      // Fall through to Neon
    }
  }
  
  const neon = await getNeonAdapter();
  return neon.query<T>(text, params);
}

export async function execute(
  text: string,
  params?: unknown[]
): Promise<{ rowCount: number }> {
  if (useD1 && d1Adapter) {
    return d1Adapter.execute(text, params);
  }
  
  // Try D1 one more time
  if (d1Adapter) {
    try {
      d1Adapter.getD1Database();
      useD1 = true;
      return d1Adapter.execute(text, params);
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
