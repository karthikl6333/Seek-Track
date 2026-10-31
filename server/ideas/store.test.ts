import { describe, expect, it } from 'vitest';
import { PRIVATE_ASSET_PREFIX, buildIdeaStore, imageContentType, readExternalImage, isValidImageName, isValidSlug, readIdeaContentFromDisk } from './store.js';

const md = (title: string, date: string) => `---\ntitle: ${title}\ndate: ${date}\nsummary: Sum ${title}.\ntags: [T]\n---\n\nBody ${title}\n`;
const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('buildIdeaStore', () => {
  const store = buildIdeaStore({
    files: { 'old.md': md('Old', '2026-01-01'), 'new.md': md('New', '2026-02-01'), 'bad.md': 'nope', 'Bad Name.md': md('X', '2026-01-01') },
    assets: { 'new/cover.jpg': b64('JPEGDATA'), 'new/x.png': b64('PNG') },
  });

  it('lists valid reports newest first, without bodies, and reports bad files', () => {
    expect(store.list.map((i) => i.slug)).toEqual(['new', 'old']);
    expect(store.list[0]).not.toHaveProperty('body');
    expect(store.errors.map((e) => e.file).sort()).toEqual(['Bad Name.md', 'bad.md']);
  });

  it('returns the body for a known slug and null for unknown or invalid slugs', () => {
    expect(store.get('new')?.body).toContain('Body New');
    expect(store.get('missing')).toBeNull();
    expect(store.get('../new')).toBeNull();
    expect(store.get('NEW')).toBeNull();
  });

  it('returns image bytes with the right content type, and null for anything not in the index', () => {
    const img = store.image('new', 'cover.jpg');
    expect(img?.contentType).toBe('image/jpeg');
    expect(Buffer.from(img!.bytes).toString()).toBe('JPEGDATA');
    expect(store.image('new', 'x.png')?.contentType).toBe('image/png');
    for (const [s, n] of [['new', 'nope.jpg'], ['old', 'cover.jpg'], ['new', '../old/cover.jpg'], ['new', '..%2fcover.jpg'], ['../new', 'cover.jpg'], ['new', 'cover.svg'], ['new', 'a/b.jpg']]) {
      expect(store.image(s, n)).toBeNull();
    }
  });

  it('flags duplicate slugs', () => {
    const s = buildIdeaStore({ files: { 'a.md': md('A', '2026-01-01'), 'a.MD': md('A2', '2026-01-02') }, assets: {} });
    expect(s.list.length).toBe(1);
    expect(s.errors[0].message).toMatch(/duplicate/);
  });
});

const brochureMd = `---\ntitle: Trip\ndate: 2026-10-31\nsummary: S.\nformat: brochure\n---\n`;

describe('brochure reports', () => {
  const page = '<html><body><img src="img/a.webp" alt=""><p>hello</p></body></html>';
  const store = buildIdeaStore({
    files: { 'trip.md': brochureMd, 'plain.md': md('Plain', '2026-01-01') },
    assets: {},
    pages: { 'trip.html': page, 'plain.html': '<p>ignored, not a brochure</p>' },
    external: { 'trip/a.webp': `${PRIVATE_ASSET_PREFIX}/abc.webp` },
  });

  it('serves the page and the external image location only for brochure reports', () => {
    expect(store.errors).toEqual([]);
    expect(store.list.find((i) => i.slug === 'trip')?.format).toBe('brochure');
    expect(store.page('trip')).toBe(page);
    expect(store.page('plain')).toBeNull(); // a stray pages/ file for a Markdown report is never served
    expect(store.page('../trip')).toBeNull();
    expect(store.externalImage('trip', 'a.webp')).toEqual({ location: `${PRIVATE_ASSET_PREFIX}/abc.webp`, contentType: 'image/webp' });
    for (const [s, n] of [['trip', 'b.webp'], ['trip', '../a.webp'], ['plain', 'a.webp'], ['trip', 'a.svg']]) {
      expect(store.externalImage(s, n)).toBeNull();
    }
    expect(store.image('trip', 'a.webp')).toBeNull(); // not embedded in the worker
  });

  it.each([
    ['inline data: image', '<img src="data:image/jpeg;base64,AAAA">', /relative "img/],
    ['remote image', '<img src="https://example.com/x.jpg">', /relative "img/],
    ['path traversal', '<img src="img/../x.webp">', /relative "img/],
    ['missing file', '<img src="img/zzz.webp">', /missing from content\/ideas\/assets\/trip/],
  ])('rejects a brochure with %s', (_n, html, msg) => {
    const s = buildIdeaStore({
      files: { 'trip.md': brochureMd },
      assets: {},
      pages: { 'trip.html': html },
      external: { 'trip/a.webp': '/x/a.webp' },
    });
    expect(s.list).toEqual([]);
    expect(s.errors[0].message).toMatch(msg);
  });

  it('a brochure without a page file is an error', () => {
    const s = buildIdeaStore({ files: { 'trip.md': brochureMd }, assets: {} });
    expect(s.errors[0].message).toMatch(/pages\/trip\.html/);
  });
});

describe('readExternalImage', () => {
  it('fetches a private-prefix location through the ASSETS binding (and only a 200 counts)', async () => {
    const seen: string[] = [];
    const ok = { fetch: async (r: Request) => (seen.push(new URL(r.url).pathname), new Response(new Uint8Array([1, 2, 3]))) };
    expect(Array.from((await readExternalImage(`${PRIVATE_ASSET_PREFIX}/h.webp`, ok, 'https://x.test/api/ideas/t/img/a.webp'))!)).toEqual([1, 2, 3]);
    expect(seen).toEqual([`${PRIVATE_ASSET_PREFIX}/h.webp`]);
    const notFound = { fetch: async () => new Response('nope', { status: 404 }) };
    expect(await readExternalImage(`${PRIVATE_ASSET_PREFIX}/h.webp`, notFound, 'https://x.test/')).toBeNull();
    expect(await readExternalImage(`${PRIVATE_ASSET_PREFIX}/h.webp`, undefined, 'https://x.test/')).toBeNull();
  });
  it('reads a disk location (Node) and returns null when it is gone', async () => {
    expect(await readExternalImage('/nonexistent/dir/a.webp', undefined, 'https://x.test/')).toBeNull();
  });
});

describe('name validation', () => {
  it('slugs: lowercase letters, digits, dashes only', () => {
    for (const ok of ['a', 'abc-1', '0x']) expect(isValidSlug(ok)).toBe(true);
    for (const bad of ['', '-a', 'A', 'a_b', 'a/b', '..', '../x', 'a.b', 'a b', 'x'.repeat(101)]) expect(isValidSlug(bad)).toBe(false);
  });
  it('image names: plain file name with a raster extension', () => {
    for (const ok of ['cover.jpg', 'day-9.JPG', 'a_b.1.png', 'x.webp']) expect(isValidImageName(ok)).toBe(true);
    for (const bad of ['', '.jpg', '.hidden.jpg', 'a/b.jpg', 'a\\b.jpg', '../a.jpg', 'a..b.jpg', 'a.svg', 'a.html', 'a.jpg.html', 'a.jpg\0', 'a b.jpg']) {
      expect(isValidImageName(bad)).toBe(false);
    }
    expect(imageContentType('a.JPEG')).toBe('image/jpeg');
    expect(imageContentType('a.svg')).toBeNull();
  });
});

describe('bundled content (content/ideas)', () => {
  it('every report file parses, slugs are unique, images referenced exist and no link uses /reports', async () => {
    const raw = await readIdeaContentFromDisk();
    const store = buildIdeaStore(raw);
    expect(store.errors).toEqual([]);
    expect(store.list.length).toBeGreaterThanOrEqual(2);
    expect(new Set(store.list.map((i) => i.slug)).size).toBe(store.list.length);
    for (const meta of store.list.filter((i) => i.format === 'markdown')) {
      const body = store.get(meta.slug)!.body;
      expect(body).not.toMatch(/\]\(\/?reports\//);
      expect(body).not.toMatch(/cursor\.com\/canvas/);
      for (const m of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
        if (/^https?:\/\//.test(m[1])) continue;
        const r = /^assets\/([a-z0-9-]+)\/([^/]+)$/.exec(m[1]);
        expect(r && store.image(r[1], r[2]), `${meta.slug}: ${m[1]}`).toBeTruthy();
      }
    }
    // embedded (Markdown report) images are under 200 KB each
    for (const [k, v] of Object.entries(raw.assets)) expect(Buffer.from(v, 'base64').length, k).toBeLessThan(200 * 1024);
  });

  it('the Hong Kong & Macau brochure: a small self-contained page, every image a file on disk', async () => {
    const raw = await readIdeaContentFromDisk();
    const store = buildIdeaStore(raw);
    const hk = store.get('hong-kong-macau-family-trip-jan-2027');
    expect(hk?.format).toBe('brochure');
    expect(hk?.tags).toContain('Travel');
    expect(hk?.title).toBe('Hong Kong & Macau Family Adventure, 9–17 Jan 2027');
    const page = store.page('hong-kong-macau-family-trip-jan-2027')!;
    expect(page).toContain('CX 601');
    expect(page).not.toMatch(/data:image|base64,/); // images are files, not inlined
    expect(Buffer.byteLength(page)).toBeLessThan(300 * 1024); // the page itself is small enough to embed in the worker
    // external links must open in a new tab (inside the sandboxed iframe a plain link would replace the brochure)
    const external = [...page.matchAll(/<a\b[^>]*\bhref="https?:\/\/[^>]*>/g)].map((m) => m[0]);
    expect(external.length).toBeGreaterThan(50);
    expect(external.filter((a) => !/target="_blank"/.test(a) || !/rel="[^"]*noopener/.test(a))).toEqual([]);
    expect(page).not.toMatch(/<(?:iframe|form|base|link|object|embed)\b/i);
    const refs = [...page.matchAll(/<img\b[^>]*?\bsrc="img\/([^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(50);
    for (const name of refs) expect(store.externalImage('hong-kong-macau-family-trip-jan-2027', name), name).toBeTruthy();
    // external images are disk paths here, each under 200 KB
    const { statSync } = await import('node:fs');
    for (const [k, p] of Object.entries(raw.external!)) expect(statSync(p).size, k).toBeLessThan(200 * 1024);
    // none of the brochure images are embedded in the worker content
    expect(Object.keys(raw.assets).some((k) => k.startsWith('hong-kong'))).toBe(false);
  });
});
