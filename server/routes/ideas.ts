import type { Context, Hono } from 'hono';
import { getIdeaStore, isValidImageName, isValidSlug } from '../ideas/store.js';

/**
 * Ideas (saved research reports). Authed like every other /api route: the auth middleware is registered
 * for '*' before these (see routes/middleware.ts), so a request without valid Basic credentials never
 * reaches a handler. Responses are `private` so shared caches/CDNs never store them.
 *
 *   GET /api/ideas                        list metadata (newest first)
 *   GET /api/ideas/:slug                  one report: metadata + Markdown body
 *   GET /api/ideas/:slug/img/:name        one image's bytes
 */
export function registerIdeasRoutes(app: Hono): void {
  app.get('/api/ideas', async (c) => {
    const store = await loadStore(c);
    if (store instanceof Response) return store;
    c.header('Cache-Control', 'private, no-cache');
    return c.json({ ideas: store.list, errors: store.errors });
  });

  app.get('/api/ideas/:slug', async (c) => {
    const slug = c.req.param('slug');
    if (!isValidSlug(slug)) return c.json({ error: 'invalid report id' }, 400);
    const store = await loadStore(c);
    if (store instanceof Response) return store;
    const idea = store.get(slug);
    if (!idea) return c.json({ error: 'report not found' }, 404);
    c.header('Cache-Control', 'private, no-cache');
    return c.json(idea);
  });

  app.get('/api/ideas/:slug/img/:name', async (c) => {
    const slug = c.req.param('slug');
    const name = c.req.param('name');
    if (!isValidSlug(slug) || !isValidImageName(name)) return c.json({ error: 'invalid image' }, 400);
    const store = await loadStore(c);
    if (store instanceof Response) return store;
    const img = store.image(slug, name);
    if (!img) return c.json({ error: 'image not found' }, 404);
    return new Response(img.bytes, {
      headers: {
        'Content-Type': img.contentType,
        'Content-Length': String(img.bytes.byteLength),
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      },
    });
  });
}

async function loadStore(c: Context) {
  try {
    return await getIdeaStore();
  } catch (err) {
    console.error('ideas: failed to load content:', err);
    return c.json({ error: 'reports unavailable' }, 500);
  }
}
