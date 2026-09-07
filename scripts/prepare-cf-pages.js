#!/usr/bin/env node
/**
 * Prepare Cloudflare Pages deployment structure
 * Copies dist/ (static assets) and creates a _worker.js for the API
 * Embeds schema.sql into db.js so it doesn't need filesystem access
 */

import { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = process.cwd();
const distClient = join(rootDir, 'dist');
const distServer = join(rootDir, 'dist-server');
const cfDist = join(rootDir, 'dist-cf');

// Clean and create dist-cf directory
if (existsSync(cfDist)) {
  cpSync(cfDist, join(cfDist, '..', '.dist-cf-backup'), { recursive: true, force: true });
  console.log('Backed up existing dist-cf/');
}

mkdirSync(cfDist, { recursive: true });

// Copy static client assets
console.log('Copying client assets from dist/ to dist-cf/...');
cpSync(distClient, cfDist, { recursive: true });

// Copy compiled server code
console.log('Copying server code from dist-server/ to dist-cf/dist-server/...');
const cfServerDir = join(cfDist, 'dist-server');
mkdirSync(cfServerDir, { recursive: true });
cpSync(distServer, cfServerDir, { recursive: true });

// Read schema.sql and embed it into db.js
console.log('Embedding schema.sql into db.js for Workers compatibility...');
const schemaPath = join(rootDir, 'server', 'schema.sql');
const schemaSql = readFileSync(schemaPath, 'utf8');
const dbJsPath = join(cfServerDir, 'db.js');
let dbJsContent = readFileSync(dbJsPath, 'utf8');

// Replace the placeholder with the actual schema as a string literal
// Escape backticks and backslashes in the SQL
const escapedSql = schemaSql.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
dbJsContent = dbJsContent.replace(
  '// @SCHEMA_SQL_PLACEHOLDER@\nlet EMBEDDED_SCHEMA = null;',
  `// Schema embedded at build time for Cloudflare Workers\nconst EMBEDDED_SCHEMA = \`${escapedSql}\`;`
);
writeFileSync(dbJsPath, dbJsContent, 'utf8');
console.log('✅ Schema embedded successfully');

// Create _worker.js for Cloudflare Pages Advanced mode
console.log('Creating _worker.js for Cloudflare Pages...');
const workerJs = `
// Cloudflare Pages _worker.js
// This worker handles all API routes and serves static assets

import app from './dist-server/index.js';
import { ensureSchema } from './dist-server/db.js';
import { ensureSeedPairsCached } from './dist-server/pairs.js';
import { ensureResearchSeeded } from './dist-server/research.js';
import { ensureWatchlistSeeded } from './dist-server/watchlist.js';

let schemaInitialized = false;

export default {
  async fetch(request, env, ctx) {
    // Initialize schema once per cold start
    if (!schemaInitialized) {
      try {
        // Pass Cloudflare environment variables to process.env
        if (env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;
        if (env.AUTH_PASSWORD) process.env.AUTH_PASSWORD = env.AUTH_PASSWORD;
        if (env.AUTH_USER) process.env.AUTH_USER = env.AUTH_USER;
        
        await ensureSchema();
        await ensureSeedPairsCached();
        await ensureResearchSeeded();
        await ensureWatchlistSeeded();
        schemaInitialized = true;
        console.log('Schema initialized for Cloudflare Pages');
      } catch (err) {
        console.error('Failed to initialize schema:', err);
      }
    }

    // Forward request to Hono app
    const response = await app.fetch(request, env, ctx);
    return response;
  },
};
`;

writeFileSync(join(cfDist, '_worker.js'), workerJs.trim());

console.log('✅ Cloudflare Pages build complete!');
console.log('   Deploy dist-cf/ to Cloudflare Pages');
