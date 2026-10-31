#!/usr/bin/env node
/**
 * Prepare Cloudflare Pages deployment structure
 * Copies dist/ (static assets) and creates a _worker.js for the API
 * Embeds schema.sql into db.js so it doesn't need filesystem access
 */

import { mkdirSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { readContent, scanStaticOutput, workerEmbedsContent } from './static-leak-guard.js';

const rootDir = process.cwd();
const distClient = join(rootDir, 'dist');
const distServer = join(rootDir, 'dist-server');
const cfDist = join(rootDir, 'dist-cf');
// Server code and private report content are staged OUTSIDE the output dir: every file in dist-cf
// is a public static asset (only /api/* is behind auth). They are bundled into _worker.js, which
// Cloudflare Pages runs but never serves.
const stage = join(rootDir, '.cf-build');
const stageServer = join(stage, 'dist-server');
const contentDir = join(rootDir, 'content', 'ideas');

// Start clean so stale files (old chunks, an old dist-server/) never ship.
rmSync(cfDist, { recursive: true, force: true });
rmSync(stage, { recursive: true, force: true });
mkdirSync(cfDist, { recursive: true });
mkdirSync(stage, { recursive: true });

// Copy static client assets
console.log('Copying client assets from dist/ to dist-cf/...');
cpSync(distClient, cfDist, { recursive: true });

// Stage compiled server code (NOT inside dist-cf)
console.log('Staging server code from dist-server/ to .cf-build/dist-server/...');
cpSync(distServer, stageServer, { recursive: true });

// Read D1 schema and embed it into db-d1.js
console.log('Embedding schema-d1.sql into db-d1.js for Workers compatibility...');
const schemaPath = join(rootDir, 'server', 'schema-d1.sql');
const schemaSql = readFileSync(schemaPath, 'utf8');
const dbJsPath = join(stageServer, 'db-d1.js');
let dbJsContent = readFileSync(dbJsPath, 'utf8');

// Replace the placeholder with the actual schema as a string literal
// Escape backticks and backslashes in the SQL
const escapedSql = schemaSql.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
// NOTE: this runs on the *compiled* JS (tsc strips the `: string | null` annotation),
// so match the JS form. Fail the build if the placeholder isn't found, otherwise the
// Worker silently ships without a schema and ensureSchema() throws on every request.
const placeholderRe = /\/\/ @SCHEMA_SQL_PLACEHOLDER@\r?\nlet EMBEDDED_SCHEMA(?:: string \| null)? = null;/;
if (!placeholderRe.test(dbJsContent)) {
  console.error(`❌ Schema placeholder not found in ${dbJsPath}; cannot embed schema-d1.sql`);
  process.exit(1);
}
dbJsContent = dbJsContent.replace(
  placeholderRe,
  () => `// Schema embedded at build time for Cloudflare Workers\nconst EMBEDDED_SCHEMA = \`${escapedSql}\`;`
);
writeFileSync(dbJsPath, dbJsContent, 'utf8');
console.log('✅ Schema embedded successfully');

// Embed the Ideas reports (content/ideas) into server/ideas/store.js. Workers have no filesystem, so
// the reports + images travel inside the worker bundle and are served only by the authed /api/ideas routes.
console.log('Embedding content/ideas into the worker bundle...');
const storePath = join(stageServer, 'ideas', 'store.js');
const storeMod = await import(pathToFileURL(storePath).href);
const raw = await storeMod.readIdeaContentFromDisk(contentDir);
const checked = storeMod.buildIdeaStore(raw);
if (checked.errors.length > 0) {
  console.error('❌ Some report files are invalid and would be hidden:', JSON.stringify(checked.errors));
  process.exit(1);
}
if (checked.list.length === 0) {
  console.error(`❌ No reports found in ${contentDir}`);
  process.exit(1);
}
let storeJs = readFileSync(storePath, 'utf8');
const ideasRe = /\/\/ @IDEAS_CONTENT_PLACEHOLDER@\r?\nconst EMBEDDED_IDEAS(?:: [^=]+)? = null;/;
if (!ideasRe.test(storeJs)) {
  console.error(`❌ Ideas placeholder not found in ${storePath}; cannot embed reports`);
  process.exit(1);
}
// JSON is a valid JS expression; U+2028/2029 are escaped for older parsers.
const ideasLiteral = JSON.stringify(raw).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
storeJs = storeJs.replace(ideasRe, () => `// Reports embedded at build time (private: served only via authed /api/ideas)\nconst EMBEDDED_IDEAS = ${ideasLiteral};`);
writeFileSync(storePath, storeJs, 'utf8');
console.log(`✅ Embedded ${checked.list.length} reports and ${Object.keys(raw.assets).length} images`);

// Create _worker.js for Cloudflare Pages Advanced mode
console.log('Creating _worker.js for Cloudflare Pages...');
const workerJs = `
// Cloudflare Pages _worker.js (Advanced Mode)
// Handles API routes and serves static assets via ASSETS binding

import app from './dist-server/index.js';
import { ensureSchema, setD1Database } from './dist-server/db.js';

let schemaInitialized = false;

export default {
  async fetch(request, env, ctx) {
    // Set D1 database binding for this request
    if (env.DB) {
      setD1Database(env.DB);
    } else {
      console.error('WARNING: D1 binding (DB) not configured');
    }

    // Initialize schema once per cold start (fast — no seeding in Workers)
    if (!schemaInitialized && env.DB) {
      try {
        // Pass Cloudflare environment variables to process.env
        if (env.AUTH_PASSWORD) process.env.AUTH_PASSWORD = env.AUTH_PASSWORD;
        if (env.AUTH_USER) process.env.AUTH_USER = env.AUTH_USER;
        if (env.ALPACA_API_KEY) process.env.ALPACA_API_KEY = env.ALPACA_API_KEY;
        if (env.ALPACA_SECRET_KEY) process.env.ALPACA_SECRET_KEY = env.ALPACA_SECRET_KEY;
        if (env.ALPACA_CRYPTO_API_KEY) process.env.ALPACA_CRYPTO_API_KEY = env.ALPACA_CRYPTO_API_KEY;
        if (env.ALPACA_CRYPTO_SECRET_KEY) process.env.ALPACA_CRYPTO_SECRET_KEY = env.ALPACA_CRYPTO_SECRET_KEY;
        if (env.ALPACA_FLEX_API_KEY) process.env.ALPACA_FLEX_API_KEY = env.ALPACA_FLEX_API_KEY;
        if (env.ALPACA_FLEX_SECRET_KEY) process.env.ALPACA_FLEX_SECRET_KEY = env.ALPACA_FLEX_SECRET_KEY;
        
        // Price Alert environment variables
        if (env.ALERT_EMAIL_TO) process.env.ALERT_EMAIL_TO = env.ALERT_EMAIL_TO;
        if (env.RESEND_API_KEY) process.env.RESEND_API_KEY = env.RESEND_API_KEY;
        if (env.ALERT_EMAIL_FROM) process.env.ALERT_EMAIL_FROM = env.ALERT_EMAIL_FROM;
        if (env.ALERT_WEBHOOK_URL) process.env.ALERT_WEBHOOK_URL = env.ALERT_WEBHOOK_URL;
        
        // Schema migration only (no data seeding on Workers cold start)
        await ensureSchema();
        schemaInitialized = true;
        console.log('D1 schema initialized for Cloudflare Pages');
      } catch (err) {
        console.error('Failed to initialize D1 schema:', err);
        // Continue anyway to allow health check to report the error
      }
    }

    // API routes handled by Hono app
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx);
    }

    // Static assets served by Cloudflare Pages ASSETS binding
    // Try ASSETS first, then fallback to Hono app (includes index.html SPA fallback)
    try {
      if (env.ASSETS) {
        const assetResponse = await env.ASSETS.fetch(request);
        // If asset found (200), return it; otherwise fall through to Hono SPA handler
        if (assetResponse.status < 400) {
          return assetResponse;
        }
      }
    } catch {
      // ASSETS fetch failed; fall through to app handler
    }

    // Fallback to Hono app for SPA routing (serves index.html for non-API routes)
    return app.fetch(request, env, ctx);
  },
};
`;

writeFileSync(join(stage, 'worker-entry.js'), workerJs.trim());

// Bundle the entry + server code + embedded content into ONE file: dist-cf/_worker.js.
// packages: 'external' keeps bare imports (hono, node:*, ...) resolved by wrangler/Pages exactly as
// before. No sourcemap on purpose (a .map in dist-cf would be a public static asset).
await build({
  entryPoints: [join(stage, 'worker-entry.js')],
  outfile: join(cfDist, '_worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['workerd', 'worker', 'import'],
  packages: 'external',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
});
rmSync(stage, { recursive: true, force: true });

// Privacy guard: fail the build if any private report content reached the public static output.
console.log('Scanning dist-cf/ for leaked report content...');
const content = readContent(contentDir);
const problems = [...workerEmbedsContent(cfDist, content), ...scanStaticOutput(cfDist, content)];
if (problems.length > 0) {
  console.error('❌ Static output privacy guard failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('✅ No report text or images in the static output (only inside _worker.js)');

console.log('✅ Cloudflare Pages build complete!');
console.log('   Deploy dist-cf/ to Cloudflare Pages');
