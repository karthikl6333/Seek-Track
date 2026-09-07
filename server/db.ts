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

// Embedded schema for Cloudflare Workers (injected at build time by prepare-cf-pages.js)
// @SCHEMA_SQL_PLACEHOLDER@
let EMBEDDED_SCHEMA: string | null = null;

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
  
  let sql: string | null = EMBEDDED_SCHEMA;
  
  // If schema not embedded (local dev), try reading from filesystem
  if (!sql && typeof process !== 'undefined' && process.versions?.node) {
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
          sql = readFileSync(path, 'utf8');
          break;
        } catch {
          // try next
        }
      }
    } catch (err) {
      console.error('Failed to load schema from filesystem:', err);
    }
  }
  
  if (!sql) {
    throw new Error('Could not find schema.sql (not embedded and filesystem unavailable)');
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
