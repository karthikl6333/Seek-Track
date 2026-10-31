import type { Hono } from 'hono';
import {
  getResearchHandler,
  postResearchRefreshHandler,
  postResearchUniverseHandler,
  putResearchUniverseReorderHandler,
  deleteResearchUniverseHandler,
  getResearchSymbolHandler,
} from '../research/handlers.js';

/** Routes: research universe. */
export function registerResearchRoutes(app: Hono): void {
  app.get('/api/research', getResearchHandler);
  app.post('/api/research/refresh', postResearchRefreshHandler);
  app.post('/api/research/universe', postResearchUniverseHandler);
  app.put('/api/research/universe/reorder', putResearchUniverseReorderHandler);
  app.delete('/api/research/universe/:symbol', deleteResearchUniverseHandler);
  app.get('/api/research/:symbol', getResearchSymbolHandler);
}
