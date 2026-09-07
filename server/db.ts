import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neonConfig, Pool, type NeonQueryFunction, type PoolClient } from '@neondatabase/serverless';

// Neon serverless Pool for Cloudflare Workers compatibility
// Falls back to node-pg Pool for local development

let pool: Pool | null = null;
let isCloudflareEnv = false;

// Detect Cloudflare Workers environment
if (typeof globalThis !== 'undefined') {
  // Cloudflare Workers have WebSockets built-in or through cf-socket-polyfill
  isCloudflareEnv = 
    (typeof process === 'undefined' || !process.versions?.node) ||
    typeof (globalThis as any).WebSocketPair !== 'undefined';
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required');
    }

    // Configure Neon for Cloudflare Workers (uses fetch for WebSocket upgrade)
    if (isCloudflareEnv) {
      // In Cloudflare Workers, use fetch-based WebSocket
      neonConfig.fetchConnectionCache = true;
      // Cloudflare Workers have a global fetch
      neonConfig.webSocketConstructor = (globalThis as any).WebSocket;
    }

    pool = new Pool({ 
      connectionString,
      // Neon serverless handles SSL automatically
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

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number | null;
}

export async function query<T = any>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const result = await getPool().query(text, params);
  return {
    rows: result.rows as T[],
    rowCount: result.rowCount,
  };
}
