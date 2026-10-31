import { describe, expect, it } from 'vitest';
import { IDEAS, IDEA_ASSET_KEYS, IDEA_ERRORS, resolveIdeaAsset } from './index';
import { renderIdeaMarkdown } from '../../pages/ideas/markdown';

describe('bundled Ideas content', () => {
  it('every report file parses (no load errors) and slugs are unique', () => {
    expect(IDEA_ERRORS).toEqual([]);
    expect(new Set(IDEAS.map((i) => i.slug)).size).toBe(IDEAS.length);
    expect(IDEAS.length).toBeGreaterThanOrEqual(2);
  });

  it('is sorted newest first and every report has title, summary and tags', () => {
    const dates = IDEAS.map((i) => i.date);
    expect(dates).toEqual([...dates].sort().reverse());
    for (const i of IDEAS) {
      expect(i.title.length).toBeGreaterThan(5);
      expect(i.summary.length).toBeGreaterThan(20);
      expect(i.tags.length).toBeGreaterThan(0);
      expect(i.body.length).toBeGreaterThan(500);
    }
  });

  it('the Hong Kong & Macau report is tagged Travel', () => {
    const hk = IDEAS.find((i) => i.slug === 'hong-kong-macau-family-trip-jan-2027');
    expect(hk?.tags).toContain('Travel');
  });

  it('every local image a report references exists in the bundle', () => {
    const missing: string[] = [];
    let refs = 0;
    for (const i of IDEAS) {
      for (const m of i.body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
        if (/^https?:\/\//.test(m[1])) continue;
        refs += 1;
        if (!resolveIdeaAsset(m[1])) missing.push(`${i.slug}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
    expect(refs).toBeGreaterThan(0);
    expect(IDEA_ASSET_KEYS.length).toBeGreaterThan(0);
  });

  it('every report renders to HTML, and no link points at the /reports path (404 in prod)', () => {
    for (const i of IDEAS) {
      const { html } = renderIdeaMarkdown(i.body, resolveIdeaAsset);
      expect(html.length).toBeGreaterThan(1000);
      expect(html).not.toMatch(/(?:src|href)="\/?reports\//);
    }
  });
});
