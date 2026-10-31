import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerApi } from './index.js';

/** The public API surface, in registration order. A refactor must not add, drop or reorder these. */
const EXPECTED = [
  'GET /api/health',
  'GET /api/trades',
  'POST /api/trades',
  'PATCH /api/trades/:id',
  'POST /api/import',
  'GET /api/marks',
  'GET /api/news/top',
  'PUT /api/marks',
  'GET /api/quotes/universe',
  'POST /api/quotes/refresh',
  'GET /api/quotes/refresh',
  'GET /api/quotes/stream',
  'POST /api/quotes/live-refresh',
  'GET /api/pairs',
  'GET /api/pairs/resolve',
  'GET /api/pairs/resolve/:symbol',
  'PUT /api/pairs',
  'GET /api/journal',
  'POST /api/journal',
  'DELETE /api/journal',
  'DELETE /api/journal/:id',
  'GET /api/settings',
  'PUT /api/settings',
  'GET /api/research',
  'POST /api/research/refresh',
  'POST /api/research/universe',
  'PUT /api/research/universe/reorder',
  'DELETE /api/research/universe/:symbol',
  'GET /api/research/:symbol',
  'GET /api/watchlist',
  'POST /api/watchlist',
  'DELETE /api/watchlist/:symbol',
  'POST /api/watchlist/refresh',
  'GET /api/paper',
  'POST /api/paper/refresh',
  'POST /api/paper/state',
  'POST /api/paper/positions',
  'POST /api/paper/orders',
  'POST /api/paper/journal',
  'GET /api/crypto-paper',
  'POST /api/crypto-paper/state',
  'POST /api/crypto-paper/positions',
  'POST /api/crypto-paper/orders',
  'POST /api/crypto-paper/journal',
  'POST /api/crypto-paper/refresh',
  'GET /api/paper-flex',
  'POST /api/paper-flex/refresh',
  'POST /api/paper-flex/state',
  'POST /api/paper-flex/positions',
  'POST /api/paper-flex/orders',
  'POST /api/paper-flex/journal',
  'GET /api/alerts',
  'POST /api/alerts',
  'DELETE /api/alerts/:id',
  'POST /api/alerts/evaluate',
  'GET /api/plan-rules',
  'POST /api/plan-rules',
  'PATCH /api/plan-rules/:id',
  'DELETE /api/plan-rules/:id',
  'GET /api/ideas',
  'GET /api/ideas/:slug',
  'GET /api/ideas/:slug/img/:name',
  'GET /api/ideas/:slug/page',
];

describe('API route table', () => {
  it('registers exactly the expected routes, in order', () => {
    const app = new Hono();
    registerApi(app);
    const actual = app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`);
    expect([...actual].sort()).toEqual([...EXPECTED].sort());
    // Specific research paths must precede the `:symbol` catch-all.
    expect(actual.indexOf('PUT /api/research/universe/reorder')).toBeLessThan(actual.indexOf('GET /api/research/:symbol'));
  });

  it('applies auth and budget middleware to API routes before any route', () => {
    const app = new Hono();
    registerApi(app);
    const firstRoute = app.routes.findIndex((r) => r.method !== 'ALL');
    expect(firstRoute).toBeGreaterThan(0);
    expect(app.routes.slice(0, firstRoute).every((r) => r.method === 'ALL')).toBe(true);
  });
});
