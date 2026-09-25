import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createAuthMiddleware } from './auth.js';
import { ensureSchema, query } from './db.js';
import { deleteJournal, listJournal, postJournal } from './journal.js';
import {
  ensureSeedPairsCached,
  listPairsHandler,
  putPairOverrideHandler,
  resolvePairHandler,
} from './pairs.js';
import {
  getMarksHandler,
  putMarksHandler,
  getUniverseHandler,
  refreshQuotesHandler,
} from './quotes.js';
import { handleQuoteStream } from './quote-stream.js';
import {
  startQuoteServiceLoop,
  stopQuoteServiceLoop,
} from './quote-service.js';
import {
  deleteResearchUniverseHandler,
  ensureResearchSeeded,
  getResearchHandler,
  getResearchSymbolHandler,
  postResearchRefreshHandler,
  postResearchUniverseHandler,
  putResearchUniverseReorderHandler,
  startResearchRefreshCron,
} from './research.js';
import {
  deleteWatchlistHandler,
  ensureWatchlistSeeded,
  getWatchlistHandler,
  postWatchlistHandler,
  postWatchlistRefreshHandler,
} from './watchlist.js';
import { getSettings, putSettings } from './settings.js';
import {
  importCsvHandler,
  listTrades,
  patchTrade,
  postTrades,
} from './trades.js';
import {
  getPaperSummary,
  postPaperJournal,
  refreshPaperFromAlpaca,
  upsertPaperOrders,
  upsertPaperPositions,
  upsertPaperState,
} from './paper.js';
import {
  getCryptoPaperSummary,
  postCryptoPaperJournal,
  refreshCryptoPaperLivePnl,
  upsertCryptoPaperOrders,
  upsertCryptoPaperPositions,
  upsertCryptoPaperState,
} from './crypto-paper.js';
import {
  getPaperFlexSummary,
  postPaperFlexJournal,
  refreshPaperFlexFromAlpaca,
  upsertPaperFlexOrders,
  upsertPaperFlexPositions,
  upsertPaperFlexState,
} from './paper-flex.js';
import {
  getNewsHandler,
  refreshNewsHandler,
} from './news.js';

const app = new Hono();

app.use(
  '/api/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

// Apply authentication middleware to all API routes and frontend
// (excludes /api/health for monitoring)
app.use('*', createAuthMiddleware());

app.get('/api/health', async (c) => {
  try {
    await query('SELECT 1');
    return c.json({ ok: true });
  } catch (err) {
    console.error('health check failed:', err);
    return c.json({ ok: false, error: 'database unavailable' }, 503);
  }
});

app.get('/api/trades', listTrades);
app.post('/api/trades', postTrades);
app.patch('/api/trades/:id', patchTrade);
app.post('/api/import', importCsvHandler);

app.get('/api/marks', getMarksHandler);
app.put('/api/marks', putMarksHandler);
app.get('/api/quotes/universe', getUniverseHandler);
app.post('/api/quotes/refresh', refreshQuotesHandler);
app.get('/api/quotes/refresh', refreshQuotesHandler);
app.get('/api/quotes/stream', handleQuoteStream);

app.get('/api/pairs', listPairsHandler);
app.get('/api/pairs/resolve', resolvePairHandler);
app.get('/api/pairs/resolve/:symbol', resolvePairHandler);
app.put('/api/pairs', putPairOverrideHandler);

app.get('/api/journal', listJournal);
app.post('/api/journal', postJournal);
app.delete('/api/journal', deleteJournal);
app.delete('/api/journal/:id', deleteJournal);

app.get('/api/settings', getSettings);
app.put('/api/settings', putSettings);

app.get('/api/research', getResearchHandler);
app.post('/api/research/refresh', postResearchRefreshHandler);
app.post('/api/research/universe', postResearchUniverseHandler);
app.put('/api/research/universe/reorder', putResearchUniverseReorderHandler);
app.delete('/api/research/universe/:symbol', deleteResearchUniverseHandler);
app.get('/api/research/:symbol', getResearchSymbolHandler);

app.get('/api/watchlist', getWatchlistHandler);
app.post('/api/watchlist', postWatchlistHandler);
app.delete('/api/watchlist/:symbol', deleteWatchlistHandler);
app.post('/api/watchlist/refresh', postWatchlistRefreshHandler);

app.get('/api/paper', getPaperSummary);
app.post('/api/paper/refresh', refreshPaperFromAlpaca);
app.post('/api/paper/state', upsertPaperState);
app.post('/api/paper/positions', upsertPaperPositions);
app.post('/api/paper/orders', upsertPaperOrders);
app.post('/api/paper/journal', postPaperJournal);

app.get('/api/crypto-paper', getCryptoPaperSummary);
app.post('/api/crypto-paper/state', upsertCryptoPaperState);
app.post('/api/crypto-paper/positions', upsertCryptoPaperPositions);
app.post('/api/crypto-paper/orders', upsertCryptoPaperOrders);
app.post('/api/crypto-paper/journal', postCryptoPaperJournal);
app.post('/api/crypto-paper/refresh', refreshCryptoPaperLivePnl);

app.get('/api/paper-flex', getPaperFlexSummary);
app.post('/api/paper-flex/refresh', refreshPaperFlexFromAlpaca);
app.post('/api/paper-flex/state', upsertPaperFlexState);
app.post('/api/paper-flex/positions', upsertPaperFlexPositions);
app.post('/api/paper-flex/orders', upsertPaperFlexOrders);
app.post('/api/paper-flex/journal', postPaperFlexJournal);

app.get('/api/news', getNewsHandler);
app.post('/api/news/refresh', refreshNewsHandler);

// Initialize background jobs for Workers (crons self-disable; seeding functions are safe no-ops after first run)
// This ensures Workers have schema ready but skip expensive seeding/cron operations
if (typeof process === 'undefined' || !process.versions?.node) {
  // Workers environment: disabled (use on-demand refresh only)
  startResearchRefreshCron(15 * 60 * 1000);
}

// Export app for Cloudflare Workers/Pages Functions (must be before any Node-specific code)
export default app;

// Setup static file serving for Node.js (not used in Cloudflare Workers)
async function setupStaticServing() {
  if (typeof process === 'undefined' || !process.versions?.node) {
    // Not Node.js - Cloudflare serves static files directly
    return;
  }
  
  try {
    // Dynamic imports for Node-only modules
    const { serveStatic } = await import('@hono/node-server/serve-static');
    const { existsSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    
    const here = dirname(fileURLToPath(import.meta.url));
    const distCandidates = [
      join(process.cwd(), 'dist'),
      join(here, '..', 'dist'),
      join(here, 'dist'),
    ];
    const distRoot = distCandidates.find((p) => existsSync(join(p, 'index.html')));

    if (distRoot) {
      let relativeRoot = distRoot;
      const cwd = process.cwd();
      if (distRoot.startsWith(cwd)) {
        relativeRoot = distRoot.slice(cwd.length).replace(/^[/\\]/, '') || '.';
      }
      app.use('/*', serveStatic({ root: relativeRoot }));
      app.get('*', serveStatic({ root: relativeRoot, path: 'index.html' }));
    } else {
      app.get('/', (c) => c.text('Seek&Track API - build client first'));
    }
  } catch (err) {
    console.error('Failed to setup static serving:', err);
    app.get('/', (c) => c.text('Seek&Track API - static assets not available'));
  }
}

const port = Number(process.env.PORT || 3000);

// Node.js server entry (development and traditional hosting)
async function main() {
  await setupStaticServing();
  await ensureSchema();
  
  // Seed data ONLY in local Node.js development (never in Workers/Cloudflare)
  // Workers have expensive cold starts; seeding should be done via separate migration/admin tool
  await ensureSeedPairsCached();
  await ensureResearchSeeded();
  await ensureWatchlistSeeded();
  
  startQuoteServiceLoop(); // Unified 15-second quote refresh
  startResearchRefreshCron(15 * 60 * 1000);
  console.log('Seek&Track listening on :' + String(port));
  
  // Dynamic import for Node-only server
  const { serve: startServer } = await import('@hono/node-server');
  startServer({ fetch: app.fetch, port });
}

// Only run server when executed directly (not when imported by Workers)
if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Failed to start server:', err);
    process.exitCode = 1;
  });
}
