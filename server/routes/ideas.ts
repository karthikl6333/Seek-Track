import type { Context, Hono } from 'hono';
import { getIdeaStore, isValidImageName, isValidSlug, readExternalImage } from '../ideas/store.js';

/**
 * Ideas (saved research reports). Authed like every other /api route: the auth middleware is registered
 * for '*' before these (see routes/middleware.ts), so a request without valid Basic credentials never
 * reaches a handler. Responses are `private` so shared caches/CDNs never store them.
 *
 *   GET /api/ideas                        list metadata (newest first)
 *   GET /api/ideas/:slug                  one report: metadata + Markdown body
 *   GET /api/ideas/:slug/img/:name        one image's bytes
 *   GET /api/ideas/:slug/page             the HTML page of a `format: brochure` report (for a sandboxed iframe)
 *   ALL /_private/*                       always 404 (401 first without credentials): see the worker gate
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
    let img: { bytes: Uint8Array; contentType: string } | null = store.image(slug, name);
    if (!img) {
      // Brochure images are not in the worker bundle: fetch them server-side (never by a client URL).
      const ext = store.externalImage(slug, name);
      const bytes = ext ? await readExternalImage(ext.location, assetsBinding(c), c.req.url) : null;
      img = ext && bytes ? { bytes, contentType: ext.contentType } : null;
    }
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

  app.get('/api/ideas/:slug/page', async (c) => {
    const slug = c.req.param('slug');
    if (!isValidSlug(slug)) return c.json({ error: 'invalid report id' }, 400);
    const store = await loadStore(c);
    if (store instanceof Response) return store;
    const html = store.page(slug);
    if (html === null) return c.json({ error: 'report page not found' }, 404);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        // Own scripts/styles are inline; images only from this origin (the img/ route above); no
        // forms, no remote loads, no <base>. Only this site may frame it.
        'Content-Security-Policy':
          "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  });

  // The static output has a private image prefix (/_private/...). The worker routes every request for it
  // here, after the auth middleware: no credentials -> 401, credentials -> 404. It is never served directly.
  app.all('/_private/*', (c) => c.json({ error: 'not found' }, 404));
}

function assetsBinding(c: Context): { fetch(request: Request): Promise<Response> } | undefined {
  const env = c.env as { ASSETS?: { fetch(request: Request): Promise<Response> } } | undefined;
  return env?.ASSETS;
}

async function loadStore(c: Context) {
  try {
    return await getIdeaStore();
  } catch (err) {
    console.error('ideas: failed to load content:', err);
    return c.json({ error: 'reports unavailable' }, 500);
  }
}
