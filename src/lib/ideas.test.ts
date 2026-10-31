import { describe, expect, it } from 'vitest';
import { filterIdeas, formatIdeaDate, ideaAssetUrl, ideaHash, ideaSlugFromHash, tagCounts, type IdeaMeta } from './ideas';

describe('tags and search', () => {
  const mk = (slug: string, date: string, title: string, tags: string[], summary = 's'): IdeaMeta => ({
    slug,
    title,
    date,
    summary,
    tags,
    minutes: 1,
  });
  const a = mk('a', '2026-10-01', 'Alpha', ['Travel', 'Budget']);
  const b = mk('b', '2026-10-31', 'Bravo', ['AI'], 'Gene editing in rice');
  const c = mk('c', '2026-10-31', 'Aardvark', ['Travel']);

  it('counts tags case-insensitively, most used first', () => {
    expect(tagCounts([a, b, c])).toEqual([
      { tag: 'Travel', count: 2 },
      { tag: 'AI', count: 1 },
      { tag: 'Budget', count: 1 },
    ]);
  });

  it('filters by tags (AND) and search words (title, summary, tags)', () => {
    const all = [a, b, c];
    expect(filterIdeas(all, new Set(), '').length).toBe(3);
    expect(filterIdeas(all, new Set(['travel']), '').map((i) => i.slug)).toEqual(['a', 'c']);
    expect(filterIdeas(all, new Set(['Travel', 'Budget']), '').map((i) => i.slug)).toEqual(['a']);
    expect(filterIdeas(all, new Set(), 'rice gene').map((i) => i.slug)).toEqual(['b']);
    expect(filterIdeas(all, new Set(['Travel']), 'aardvark').map((i) => i.slug)).toEqual(['c']);
    expect(filterIdeas(all, new Set(), 'budget').map((i) => i.slug)).toEqual(['a']);
    expect(filterIdeas(all, new Set(), 'zzz')).toEqual([]);
  });
});

describe('deep links and formatting', () => {
  it('reads and writes #ideas/<slug>', () => {
    expect(ideaSlugFromHash('#ideas/my-report')).toBe('my-report');
    expect(ideaSlugFromHash('#/ideas/my-report?x=1')).toBe('my-report');
    expect(ideaSlugFromHash('#ideas')).toBeNull();
    expect(ideaSlugFromHash('#ideas/')).toBeNull();
    expect(ideaSlugFromHash('#overview/my-report')).toBeNull();
    expect(ideaSlugFromHash('#ideas/..%2Fetc')).toBeNull();
    expect(ideaSlugFromHash('#ideas/%E0%A4%A')).toBeNull();
    expect(ideaHash('my-report')).toBe('#ideas/my-report');
    expect(ideaHash(null)).toBe('#ideas');
  });

  it('formats dates', () => {
    expect(formatIdeaDate('2026-10-31')).toBe('31 Oct 2026');
    expect(formatIdeaDate('2027-01-09')).toBe('9 Jan 2027');
    expect(formatIdeaDate('garbage')).toBe('garbage');
  });
});

describe('ideaAssetUrl', () => {
  it('maps assets/<slug>/<file> to the authed API image URL', () => {
    expect(ideaAssetUrl('assets/trip-2027/cover.jpg')).toBe('/api/ideas/trip-2027/img/cover.jpg');
    expect(ideaAssetUrl('./assets/trip/day-9.PNG', 'https://x.test')).toBe('https://x.test/api/ideas/trip/img/day-9.PNG');
  });
  it('never produces a data: URI, a static /assets path, or anything for odd refs', () => {
    for (const bad of ['', 'cover.jpg', 'assets/trip/a.svg', 'assets/trip/../a.jpg', 'assets/Trip/a.jpg', 'assets/trip/sub/a.jpg', 'data:image/png;base64,AAAA', 'https://x/a.jpg', '/assets/a.jpg', 'assets/trip/a..b.jpg']) {
      expect(ideaAssetUrl(bad), bad).toBeNull();
    }
  });
});
