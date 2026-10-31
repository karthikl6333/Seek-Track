import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const items = Array.from({ length: 5 }, (_, i) => ({
  title: `Headline ${i + 1}`,
  url: `https://publisher${i + 1}.example/story-${i + 1}`,
  source: `Publisher ${i + 1}`,
  publishedAt: `2026-10-31T0${5 - i}:00:00.000Z`,
}));
const getTopNews = vi.fn();
vi.mock('../news/top-news.js', () => ({ getTopNews: (...a: unknown[]) => getTopNews(...a) }));

const { registerNewsRoutes } = await import('./news.js');

describe('GET /api/news/top', () => {
  const app = new Hono();
  registerNewsRoutes(app);

  it('returns the top-5 payload (publisher links + publisher names)', async () => {
    getTopNews.mockResolvedValueOnce({ items, fetchedAt: '2026-10-31T06:00:00.000Z', stale: false });
    const res = await app.request('/api/news/top');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: typeof items; stale: boolean };
    expect(body.items).toHaveLength(5);
    expect(body.items.map((i) => i.source)).toEqual(items.map((i) => i.source));
    expect(body.items.every((i) => !/yahoo\./.test(i.url))).toBe(true);
    expect(body.stale).toBe(false);
  });

  it('returns an empty stale payload (200) when nothing has ever been fetched', async () => {
    getTopNews.mockResolvedValueOnce(null);
    const res = await app.request('/api/news/top');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], fetchedAt: null, stale: true });
  });
});
