import { Hono } from 'hono';
import { ensureSchema } from './db.js';
import { registerApi } from './routes/index.js';
import { setupStaticServing } from './static.js';
import { ensureSeedPairsCached } from './quotes/pairs.js';
import { startQuoteServiceLoop } from './quotes/quote-service.js';
import { ensureResearchSeeded, startResearchRefreshCron } from './research/research.js';
import { ensureWatchlistSeeded } from './quotes/watchlist.js';

const app = new Hono();
registerApi(app);

// Initialize background jobs for Workers (crons self-disable; seeding functions are safe no-ops after first run)
// This ensures Workers have schema ready but skip expensive seeding/cron operations
if (typeof process === 'undefined' || !process.versions?.node) {
  // Workers environment: disabled (use on-demand refresh only)
  startResearchRefreshCron(15 * 60 * 1000);
}

// Export app for Cloudflare Workers/Pages Functions (must be before any Node-specific code)
export default app;

const port = Number(process.env.PORT || 3000);

// Node.js server entry (development and traditional hosting)
async function main() {
  await setupStaticServing(app);
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
