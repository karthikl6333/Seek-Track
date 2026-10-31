import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerApi } from './index.js';
import { buildIdeaStore, setIdeaStoreForTests } from '../ideas/store.js';

const ENV = { AUTH_PASSWORD: 'secret-pw', AUTH_USER: 'admin' };
const AUTH = { Authorization: 'Basic ' + btoa('admin:secret-pw') };
const BAD_AUTH = { Authorization: 'Basic ' + btoa('admin:wrong') };

const md = (t: string) => `---\ntitle: ${t}\ndate: 2026-10-31\nsummary: S ${t}.\ntags: [Travel]\n---\n\nSECRET-BODY-${t}\n`;

function makeApp() {
  const app = new Hono();
  registerApi(app);
  return app;
}
const get = (app: Hono, path: string, headers: Record<string, string> = {}) => app.request(path, { headers }, ENV);

beforeEach(() => {
  setIdeaStoreForTests(
    buildIdeaStore({
      files: { 'trip.md': md('Trip') },
      assets: { 'trip/cover.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64') },
    }),
  );
});
afterEach(() => setIdeaStoreForTests(null));

describe('GET /api/ideas*: Basic auth required', () => {
  const paths = ['/api/ideas', '/api/ideas/trip', '/api/ideas/trip/img/cover.jpg', '/api/ideas/nope', '/api/ideas/trip/img/nope.jpg'];

  it.each(paths)('401 with WWW-Authenticate and no content without credentials: %s', async (p) => {
    const res = await get(makeApp(), p);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toMatch(/Basic/);
    const text = await res.text();
    expect(text).not.toMatch(/SECRET-BODY|Trip/);
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
    expect(j.ideas.map((i) => i.slug)).toEqual(['trip']);
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
