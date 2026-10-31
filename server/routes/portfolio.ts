import type { Hono } from 'hono';
import {
  listTrades,
  postTrades,
  patchTrade,
  importCsvHandler,
} from '../portfolio/trades.js';
import {
  listJournal,
  postJournal,
  deleteJournal,
} from '../portfolio/journal.js';
import {
  getSettings,
  putSettings,
} from '../portfolio/settings.js';

/** Routes: trades, CSV import, journal, settings. */
export function registerPortfolioRoutes(app: Hono): void {
  app.get('/api/trades', listTrades);
  app.post('/api/trades', postTrades);
  app.patch('/api/trades/:id', patchTrade);

  app.post('/api/import', importCsvHandler);

  app.get('/api/journal', listJournal);
  app.post('/api/journal', postJournal);
  app.delete('/api/journal', deleteJournal);
  app.delete('/api/journal/:id', deleteJournal);

  app.get('/api/settings', getSettings);
  app.put('/api/settings', putSettings);
}
