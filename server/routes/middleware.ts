import type { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createAuthMiddleware } from '../core/auth.js';
import { routeKey, withRequestBudget } from '../core/read-budget.js';

/** CORS, auth and D1 read-budget accounting. Must be registered before any route. */
export function registerMiddleware(app: Hono): void {
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

  // D1 read-budget accounting: per-route queries / rows_read, summary log every N requests,
  // X-D1-Rows-Read / X-D1-Queries response headers for quick verification.
  app.use('/api/*', async (c, next) => {
    // ?fresh=1 (sent by a client right after its own write) skips the per-isolate read cache, in
    // case that write landed on a different isolate.
    const fresh = c.req.method === 'GET' && c.req.query('fresh') === '1';
    await withRequestBudget(routeKey(c.req.method, c.req.path), async (budget) => {
      await next();
      try {
        if (!(c.res.headers.get('Content-Type') ?? '').includes('text/event-stream')) {
          c.res.headers.set('X-D1-Rows-Read', String(budget.rowsRead));
          c.res.headers.set('X-D1-Queries', String(budget.queries));
        }
      } catch {
        // immutable headers (e.g. proxied response): skip
      }
    }, { bypassCache: fresh });
  });
}
