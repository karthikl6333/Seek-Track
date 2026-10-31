import { describe, expect, it } from 'vitest';
import { buildIdeaStore, imageContentType, isValidImageName, isValidSlug, readIdeaContentFromDisk } from './store.js';

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
    const hk = store.get('hong-kong-macau-family-trip-jan-2027');
    expect(hk?.tags).toContain('Travel');
    const missing: string[] = [];
    let refs = 0;
    for (const meta of store.list) {
      const body = store.get(meta.slug)!.body;
      expect(body).not.toMatch(/\]\(\/?reports\//);
      expect(body).not.toMatch(/cursor\.com\/canvas/);
      for (const m of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
        if (/^https?:\/\//.test(m[1])) continue;
        refs += 1;
        const r = /^assets\/([a-z0-9-]+)\/([^/]+)$/.exec(m[1]);
        if (!r || !store.image(r[1], r[2])) missing.push(`${meta.slug}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
    expect(refs).toBeGreaterThan(0);
    // every image file on disk is under 200 KB
    for (const [k, v] of Object.entries(raw.assets)) expect(Buffer.from(v, 'base64').length, k).toBeLessThan(200 * 1024);
  });
});
