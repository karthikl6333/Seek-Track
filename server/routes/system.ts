import type { Hono } from 'hono';
import { query } from '../db.js';

/** Routes: health check for monitoring (excluded from auth by the middleware). */
export function registerSystemRoutes(app: Hono): void {
  app.get('/api/health', async (c) => {
    try {
      await query('SELECT 1');
      return c.json({ ok: true });
    } catch (err) {
      console.error('health check failed:', err);
      return c.json({ ok: false, error: 'database unavailable' }, 503);
    }
  });
}
