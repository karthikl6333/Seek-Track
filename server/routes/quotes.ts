import type { Hono } from 'hono';
import {
  getMarksHandler,
  putMarksHandler,
  getUniverseHandler,
  refreshQuotesHandler,
} from '../quotes/quotes.js';
import {
  handleQuoteStream,
} from '../quotes/quote-stream.js';
import {
  handleLiveRefresh,
} from '../quotes/live-refresh.js';
import {
  listPairsHandler,
  resolvePairHandler,
  putPairOverrideHandler,
} from '../quotes/pairs.js';
import {
  getWatchlistHandler,
  postWatchlistHandler,
  deleteWatchlistHandler,
  postWatchlistRefreshHandler,
} from '../quotes/watchlist.js';

/** Routes: marks, live quotes, pairs, watchlist. */
export function registerQuotesRoutes(app: Hono): void {
  app.get('/api/marks', getMarksHandler);
  app.put('/api/marks', putMarksHandler);

  app.get('/api/quotes/universe', getUniverseHandler);
  app.post('/api/quotes/refresh', refreshQuotesHandler);
  app.get('/api/quotes/refresh', refreshQuotesHandler);
  app.get('/api/quotes/stream', handleQuoteStream);
  app.post('/api/quotes/live-refresh', handleLiveRefresh);

  app.get('/api/pairs', listPairsHandler);
  app.get('/api/pairs/resolve', resolvePairHandler);
  app.get('/api/pairs/resolve/:symbol', resolvePairHandler);
  app.put('/api/pairs', putPairOverrideHandler);

  app.get('/api/watchlist', getWatchlistHandler);
  app.post('/api/watchlist', postWatchlistHandler);
  app.delete('/api/watchlist/:symbol', deleteWatchlistHandler);
  app.post('/api/watchlist/refresh', postWatchlistRefreshHandler);
}
