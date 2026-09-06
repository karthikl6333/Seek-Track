import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required');
    }
    pool = new Pool({
      connectionString,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export async function ensureSchema(): Promise<void> {
  const p = getPool();
  const here = dirname(fileURLToPath(import.meta.url));
  // In production, schema.sql is copied next to the compiled JS; in dev, same folder.
  const candidates = [
    join(here, 'schema.sql'),
    join(here, '..', 'server', 'schema.sql'),
    join(process.cwd(), 'server', 'schema.sql'),
  ];
  let sql: string | null = null;
  for (const path of candidates) {
    try {
      sql = readFileSync(path, 'utf8');
      break;
    } catch {
      // try next
    }
  }
  if (!sql) {
    throw new Error('Could not find schema.sql');
  }
  await p.query(sql);
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}
