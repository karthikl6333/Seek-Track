import { describe, expect, it } from 'vitest';
import { parseIdea, readingMinutes, slugFromPath, sortIdeas, splitFrontmatter } from './frontmatter.js';

const doc = (front: string, body = 'Body text.\n') => `---\n${front}\n---\n\n${body}`;
const OK = 'title: "A: b"\ndate: 2026-10-31\nsummary: Short one.\ntags: [Alpha, "Beta, gamma", alpha]';

describe('splitFrontmatter / parseIdea', () => {
  it('parses quoted strings, inline tag lists (with a comma inside quotes) and the body', () => {
    const i = parseIdea('./my-report.md', doc(OK, '## Hi\n\ntext'));
    expect(i).toEqual({
      slug: 'my-report',
      title: 'A: b',
      date: '2026-10-31',
      summary: 'Short one.',
      tags: ['Alpha', 'Beta, gamma'], // "alpha" is a case-insensitive duplicate
      minutes: 1,
      format: 'markdown',
      body: '## Hi\n\ntext',
    });
  });

  it('accepts CRLF, a BOM and YAML list tags; unknown keys (e.g. an old "source") are ignored', () => {
    const raw = '\uFEFF' + doc('title: T\ndate: 2026-01-02\nsummary: S\nsource: https://example.com\ntags:\n  - One\n  - Two').replace(/\n/g, '\r\n');
    const i = parseIdea('x.md', raw);
    expect(i.tags).toEqual(['One', 'Two']);
    expect(i).not.toHaveProperty('source');
    expect(i.body.trim()).toBe('Body text.');
  });

  it('rejects missing frontmatter, missing fields, bad dates and bad file names', () => {
    expect(() => parseIdea('x.md', 'no frontmatter')).toThrow(/frontmatter/);
    expect(() => parseIdea('x.md', doc('date: 2026-01-02\nsummary: S'))).toThrow(/title/);
    expect(() => parseIdea('x.md', doc('title: T\nsummary: S'))).toThrow(/date/);
    expect(() => parseIdea('x.md', doc('title: T\ndate: 2026-13-45\nsummary: S'))).toThrow(/date/);
    expect(() => parseIdea('x.md', doc('title: T\ndate: 2026-01-02'))).toThrow(/summary/);
    expect(() => parseIdea('Bad Name.md', doc(OK))).toThrow(/file name/);
    expect(() => parseIdea('../x.md', doc('title: T\ndate: 2026-01-02\nsummary: S'))).not.toThrow(); // basename "x"
  });

  it('splitFrontmatter reports an unparsable line', () => {
    expect(() => splitFrontmatter('---\nthis is not yaml\n---\n')).toThrow(/cannot parse/);
  });

  it('slugFromPath and readingMinutes', () => {
    expect(slugFromPath('./a/b/c-d.md')).toBe('c-d');
    expect(readingMinutes('')).toBe(1);
    expect(readingMinutes('word '.repeat(660))).toBe(3);
    expect(readingMinutes('![' + 'x '.repeat(500) + '](a.jpg)')).toBe(1);
  });
});

describe('sortIdeas', () => {
  it('sorts newest first, ties by title', () => {
    const out = sortIdeas([
      { date: '2026-01-01', title: 'B' },
      { date: '2026-02-01', title: 'Z' },
      { date: '2026-01-01', title: 'A' },
    ]);
    expect(out.map((x) => x.title)).toEqual(['Z', 'A', 'B']);
  });
});

describe('format: brochure', () => {
  const head = (extra: string) => `title: B title\ndate: 2026-10-31\nsummary: S.\n${extra}`;
  it('defaults to markdown; brochure needs a page and takes its reading time from the page text', () => {
    expect(parseIdea('a.md', doc(head('tags: [T]'), 'x')).format).toBe('markdown');
    expect(() => parseIdea('a.md', doc(head('format: brochure'), ''))).toThrow(/pages\/a\.html/);
    const page = `<style>.x{color:red}</style><script>var a="${'w '.repeat(900)}"</script><p>${'word '.repeat(440)}</p>`;
    const i = parseIdea('a.md', doc(head('format: brochure'), ''), page);
    expect(i.format).toBe('brochure');
    expect(i.minutes).toBe(2); // 440 visible words; style and script do not count
  });
  it('rejects an unknown format', () => {
    expect(() => parseIdea('a.md', doc(head('format: pdf'), 'x'))).toThrow(/format/);
  });
});

