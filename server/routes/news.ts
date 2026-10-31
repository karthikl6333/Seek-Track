import type { Hono } from 'hono';
import { getTopNews } from '../news/top-news.js';

/** Routes: plain top-news headlines (isolate-memory cached; never touches D1). */
export function registerNewsRoutes(app: Hono): void {
  app.get('/api/news/top', async (c) => {
    const payload = await getTopNews();
    // 200 with an empty list (not an error) so the client just hides the block / keeps the last one.
    return c.json(payload ?? { items: [], fetchedAt: null, stale: true });
  });
}
