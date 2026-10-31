import type { Hono } from 'hono';
import {
  getPaperSummary,
  refreshPaperFromAlpaca,
  upsertPaperState,
  upsertPaperPositions,
  upsertPaperOrders,
  postPaperJournal,
} from '../paper/paper.js';
import {
  getCryptoPaperSummary,
  upsertCryptoPaperState,
  upsertCryptoPaperPositions,
  upsertCryptoPaperOrders,
  postCryptoPaperJournal,
  refreshCryptoPaperLivePnl,
} from '../paper/crypto-paper.js';
import {
  getPaperFlexSummary,
  refreshPaperFlexFromAlpaca,
  upsertPaperFlexState,
  upsertPaperFlexPositions,
  upsertPaperFlexOrders,
  postPaperFlexJournal,
} from '../paper/paper-flex.js';

/** Routes: Alpaca paper books (stocks, crypto, flex). */
export function registerPaperRoutes(app: Hono): void {
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
}
