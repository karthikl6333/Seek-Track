import { describe, expect, it } from 'vitest';
import {
  filterIdeas,
  formatIdeaDate,
  ideaHash,
  ideaSlugFromHash,
  loadIdeas,
  parseIdea,
  readingMinutes,
  slugFromPath,
  sortIdeas,
  splitFrontmatter,
  tagCounts,
  type Idea,
} from './ideas';

const doc = (front: string, body = 'Body text.\n') => `---\n${front}\n---\n\n${body}`;
const OK = 'title: "A: b"\ndate: 2026-10-31\nsummary: Short one.\ntags: [Alpha, "Beta, gamma", alpha]\nsource: https://example.com/x';

describe('splitFrontmatter / parseIdea', () => {
  it('parses quoted strings, inline tag lists (with a comma inside quotes), source and body', () => {
    const i = parseIdea('./my-report.md', doc(OK, '## Hi\n\ntext'));
    expect(i).toEqual({
      slug: 'my-report',
      title: 'A: b',
      date: '2026-10-31',
      summary: 'Short one.',
      tags: ['Alpha', 'Beta, gamma'], // "alpha" is a case-insensitive duplicate
      source: 'https://example.com/x',
      body: '## Hi\n\ntext',
    });
  });

  it('accepts CRLF, a BOM, YAML list tags and a missing source', () => {
    const raw = '\uFEFF' + doc('title: T\ndate: 2026-01-02\nsummary: S\ntags:\n  - One\n  - Two').replace(/\n/g, '\r\n');
    const i = parseIdea('x.md', raw);
    expect(i.tags).toEqual(['One', 'Two']);
    expect(i.source).toBeUndefined();
    expect(i.body.trim()).toBe('Body text.');
  });

  it('treats a missing tags key as no tags', () => {
    expect(parseIdea('x.md', doc('title: T\ndate: 2026-01-02\nsummary: S')).tags).toEqual([]);
  });

  it('rejects missing frontmatter and bad or missing fields with a readable message', () => {
    expect(() => splitFrontmatter('no frontmatter')).toThrow(/frontmatter/);
    expect(() => parseIdea('x.md', doc('date: 2026-01-02\nsummary: S'))).toThrow(/title/);
    expect(() => parseIdea('x.md', doc('title: T\nsummary: S'))).toThrow(/date/);
    expect(() => parseIdea('x.md', doc('title: T\ndate: 2026-13-45\nsummary: S'))).toThrow(/date/);
    expect(() => parseIdea('x.md', doc('title: T\ndate: 31/10/2026\nsummary: S'))).toThrow(/date/);
    expect(() => parseIdea('x.md', doc('title: T\ndate: 2026-01-02'))).toThrow(/summary/);
    expect(() => parseIdea('x.md', doc('title: T\ndate: 2026-01-02\nsummary: S\nsource: javascript:alert(1)'))).toThrow(/source/);
    expect(() => parseIdea('Bad Name.md', doc('title: T\ndate: 2026-01-02\nsummary: S'))).toThrow(/file name/);
  });

  it('derives the slug from the file name', () => {
    expect(slugFromPath('./a/b/some-report.md')).toBe('some-report');
    expect(slugFromPath('plain')).toBe('plain');
  });
});

describe('sorting, loading, tags and search', () => {
  const mk = (slug: string, date: string, title: string, tags: string[], summary = 's'): Idea => ({
    slug,
    title,
    date,
    summary,
    tags,
    body: '',
  });
  const a = mk('a', '2026-10-01', 'Alpha', ['Travel', 'Budget']);
  const b = mk('b', '2026-10-31', 'Bravo', ['AI'], 'Gene editing in rice');
  const c = mk('c', '2026-10-31', 'Aardvark', ['Travel']);

  it('sorts newest first, ties by title, without mutating the input', () => {
    const input = [a, b, c];
    expect(sortIdeas(input).map((i) => i.slug)).toEqual(['c', 'b', 'a']);
    expect(input.map((i) => i.slug)).toEqual(['a', 'b', 'c']);
  });

  it('loadIdeas sorts, skips bad files and reports them (duplicates too)', () => {
    const good = (d: string) => doc(`title: T${d}\ndate: ${d}\nsummary: S`);
    const { ideas, errors } = loadIdeas({
      './old.md': good('2026-01-01'),
      './new.md': good('2026-12-01'),
      './broken.md': 'nothing here',
      './sub/old.md': good('2026-05-05'), // same slug as ./old.md
    });
    expect(ideas.map((i) => i.slug)).toEqual(['new', 'old']);
    expect(errors.map((e) => e.path).sort()).toEqual(['./broken.md', './sub/old.md']);
  });

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

  it('formats dates and reading time', () => {
    expect(formatIdeaDate('2026-10-31')).toBe('31 Oct 2026');
    expect(formatIdeaDate('2027-01-09')).toBe('9 Jan 2027');
    expect(formatIdeaDate('garbage')).toBe('garbage');
    expect(readingMinutes('word '.repeat(10))).toBe(1);
    expect(readingMinutes('word '.repeat(2200))).toBe(10);
    expect(readingMinutes('![alt text here](a.jpg)')).toBe(1);
  });
});
