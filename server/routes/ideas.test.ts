import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerApi } from './index.js';
import { PRIVATE_ASSET_PREFIX, buildIdeaStore, setIdeaStoreForTests } from '../ideas/store.js';

const ENV = { AUTH_PASSWORD: 'secret-pw', AUTH_USER: 'admin' };
const AUTH = { Authorization: 'Basic ' + btoa('admin:secret-pw') };
const BAD_AUTH = { Authorization: 'Basic ' + btoa('admin:wrong') };

const md = (t: string) => `---\ntitle: ${t}\ndate: 2026-10-31\nsummary: S ${t}.\ntags: [Travel]\n---\n\nSECRET-BODY-${t}\n`;

function makeApp() {
  const app = new Hono();
  registerApi(app);
  return app;
}
// A fake Pages ASSETS binding holding the private brochure image; records what it was asked for.
const assetCalls: string[] = [];
const ASSETS = {
  fetch: async (req: Request) => {
    const path = new URL(req.url).pathname;
    assetCalls.push(path);
    return path === `${PRIVATE_ASSET_PREFIX}/abc123.webp`
      ? new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46, 9]), { headers: { 'Content-Type': 'text/plain' } })
      : new Response('missing', { status: 404 });
  },
};
const get = (app: Hono, path: string, headers: Record<string, string> = {}) => app.request(path, { headers }, { ...ENV, ASSETS });

const BROCHURE_PAGE = '<html><body><img src="img/a.webp" alt="">SECRET-PAGE-TEXT</body></html>';

beforeEach(() => {
  setIdeaStoreForTests(
    buildIdeaStore({
      files: { 'trip.md': md('Trip'), 'hk.md': md('HK').replace('tags:', 'format: brochure\ntags:') },
      assets: { 'trip/cover.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64') },
      pages: { 'hk.html': BROCHURE_PAGE },
      external: { 'hk/a.webp': `${PRIVATE_ASSET_PREFIX}/abc123.webp` },
    }),
  );
  assetCalls.length = 0;
});
afterEach(() => setIdeaStoreForTests(null));

describe('GET /api/ideas*: Basic auth required', () => {
  const paths = [
    '/api/ideas',
    '/api/ideas/trip',
    '/api/ideas/trip/img/cover.jpg',
    '/api/ideas/nope',
    '/api/ideas/trip/img/nope.jpg',
    '/api/ideas/hk/page',
    '/api/ideas/hk/img/a.webp',
    '/api/ideas/nope/page',
    '/_private/ideas/abc123.webp',
    '/_private/',
  ];

  it.each(paths)('401 with WWW-Authenticate and no content without credentials: %s', async (p) => {
    const res = await get(makeApp(), p);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toMatch(/Basic/);
    const text = await res.text();
    expect(text).not.toMatch(/SECRET-BODY|SECRET-PAGE|Trip|RIFF/);
    expect(assetCalls).toEqual([]); // nothing was fetched on behalf of an unauthenticated request
  });

  it.each(paths)('401 with wrong credentials: %s', async (p) => {
    expect((await get(makeApp(), p, BAD_AUTH)).status).toBe(401);
  });
});

describe('authed responses', () => {
  it('lists metadata (no body), private cache', async () => {
    const res = await get(makeApp(), '/api/ideas', AUTH);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toMatch(/private/);
    const j = (await res.json()) as { ideas: Array<Record<string, unknown>>; errors: unknown[] };
    expect(j.ideas.map((i) => i.slug).sort()).toEqual(['hk', 'trip']);
    expect(j.ideas.find((i) => i.slug === 'hk')?.format).toBe('brochure');
    expect(j.ideas[0]).not.toHaveProperty('body');
    expect(j.ideas[0]).not.toHaveProperty('source');
    expect(j.errors).toEqual([]);
  });

  it('returns one report with its Markdown body; 404 for unknown, 400 for malformed slug', async () => {
    const app = makeApp();
    const ok = await get(app, '/api/ideas/trip', AUTH);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toMatch(/private/);
    expect(((await ok.json()) as { body: string }).body).toContain('SECRET-BODY-Trip');
    expect((await get(app, '/api/ideas/nope', AUTH)).status).toBe(404);
    expect((await get(app, '/api/ideas/Not_A_Slug', AUTH)).status).toBe(400);
    expect((await get(app, '/api/ideas/..%2F..%2Fetc', AUTH)).status).toBeGreaterThanOrEqual(400);
  });

  it('serves image bytes with the right content type, private caching and nosniff', async () => {
    const res = await get(makeApp(), '/api/ideas/trip/img/cover.jpg', AUTH);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toMatch(/^private/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  });

  it('rejects path traversal and odd names, even with valid credentials', async () => {
    const app = makeApp();
    const bad = [
      '/api/ideas/trip/img/..%2Fcover.jpg',
      '/api/ideas/trip/img/%2e%2e%2fcover.jpg',
      '/api/ideas/trip/img/..%5Ccover.jpg',
      '/api/ideas/..%2Ftrip/img/cover.jpg',
      '/api/ideas/trip/img/cover.svg',
      '/api/ideas/trip/img/.cover.jpg',
      '/api/ideas/trip/img/cover.jpg%00.png',
      '/api/ideas/trip/img/a..b.jpg',
      '/api/ideas/TRIP/img/cover.jpg',
    ];
    for (const p of bad) {
      const res = await get(app, p, AUTH);
      expect(res.status, p).toBeGreaterThanOrEqual(400);
      expect(res.status, p).toBeLessThan(500);
      expect(res.headers.get('Content-Type') ?? '', p).not.toMatch(/image\//);
    }
  });
});

describe('brochure page and private images', () => {
  it('serves the page as framed-by-us-only HTML with a locked-down CSP', async () => {
    const res = await get(makeApp(), '/api/ideas/hk/page', AUTH);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/html/);
    expect(res.headers.get('Cache-Control')).toMatch(/private/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("img-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("base-uri 'none'");
    expect(await res.text()).toBe(BROCHURE_PAGE);
  });

  it('404s the page for a Markdown report or an unknown slug, 400 for a malformed slug', async () => {
    const app = makeApp();
    expect((await get(app, '/api/ideas/trip/page', AUTH)).status).toBe(404);
    expect((await get(app, '/api/ideas/nope/page', AUTH)).status).toBe(404);
    expect((await get(app, '/api/ideas/Not_A_Slug/page', AUTH)).status).toBe(400);
  });

  it('serves a brochure image fetched server-side from the private static prefix, with OUR content type', async () => {
    const res = await get(makeApp(), '/api/ideas/hk/img/a.webp', AUTH);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp'); // not the asset response's text/plain
    expect(res.headers.get('Cache-Control')).toMatch(/^private/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0x52, 0x49, 0x46, 0x46, 9]);
    expect(assetCalls).toEqual([`${PRIVATE_ASSET_PREFIX}/abc123.webp`]);
  });

  it('the client can only pick names from the content index: nothing else ever reaches ASSETS', async () => {
    const app = makeApp();
    for (const p of [
      '/api/ideas/hk/img/b.webp',
      '/api/ideas/hk/img/..%2F..%2F_private%2Fideas%2Fabc123.webp',
      '/api/ideas/hk/img/abc123.webp',
      '/api/ideas/trip/img/a.webp',
      '/api/ideas/..%2Fhk/img/a.webp',
    ]) {
      const res = await get(app, p, AUTH);
      expect(res.status, p).toBeGreaterThanOrEqual(400);
      expect(res.status, p).toBeLessThan(500);
    }
    expect(assetCalls).toEqual([]);
  });

  it('a missing asset (404 from ASSETS) is a 404, not a 500 or a broken image', async () => {
    setIdeaStoreForTests(
      buildIdeaStore({
        files: { 'hk.md': md('HK').replace('tags:', 'format: brochure\ntags:') },
        assets: {},
        pages: { 'hk.html': BROCHURE_PAGE },
        external: { 'hk/a.webp': `${PRIVATE_ASSET_PREFIX}/gone.webp` },
      }),
    );
    expect((await get(makeApp(), '/api/ideas/hk/img/a.webp', AUTH)).status).toBe(404);
  });

  it('the /_private/* route answers 404 even with valid credentials: the prefix is never served directly', async () => {
    const app = makeApp();
    for (const p of ['/_private/ideas/abc123.webp', '/_private/', '/_private/x/y']) {
      const res = await get(app, p, AUTH);
      expect(res.status, p).toBe(404);
      expect(res.headers.get('Content-Type') ?? '', p).not.toMatch(/image\//);
    }
    expect(assetCalls).toEqual([]);
  });
});
