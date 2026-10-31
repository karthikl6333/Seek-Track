// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createSanitizer, headingId, renderIdeaMarkdown } from './markdown';

const assets: Record<string, string> = { 'assets/t/a.jpg': '/api/ideas/t/img/a.jpg' };
const resolve = (ref: string) => assets[ref] ?? null;
const sanitize = createSanitizer(window);
const render = (md: string) => sanitize(renderIdeaMarkdown(md, resolve).html);

describe('renderIdeaMarkdown + sanitizer', () => {
  it('renders headings with ids, paragraphs, lists, task lists and a contents list of h2s', () => {
    const r = renderIdeaMarkdown('## One\n\ntext\n\n### Sub\n\n- a\n- b\n\n* [ ] todo\n* [x] done\n\n## One\n', resolve);
    expect(r.toc).toEqual([
      { id: 'idea-one', text: 'One' },
      { id: 'idea-one-2', text: 'One' },
    ]);
    const html = sanitize(r.html);
    expect(html).toContain('<h2 id="idea-one">One</h2>');
    expect(html).toContain('<h3 id="idea-sub">Sub</h3>');
    expect(html).toContain('<li>a</li>');
    const boxes = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('input')];
    expect(boxes.map((b) => [b.type, b.disabled, b.checked])).toEqual([
      ['checkbox', true, false],
      ['checkbox', true, true],
    ]);
  });

  it('renders GFM tables inside a scroll wrapper and keeps alignment', () => {
    const html = render('| A | B |\n| --- | ---: |\n| 1 | 2 |\n');
    expect(html).toContain('<div class="idea-table-wrap"><table>');
    expect(html).toContain('<th>A</th>');
    expect(html).toMatch(/<th align="right">B<\/th>/);
    expect(html).toContain('</table></div>');
  });

  it('turns blockquotes and [!NOTE]/[!WARNING] alerts into callouts', () => {
    expect(render('> plain quote')).toContain('<blockquote class="idea-callout">');
    const warn = render('> [!WARNING]\n> Careful here.\n');
    expect(warn).toContain('idea-callout idea-callout-warning');
    expect(warn).toContain('<p class="idea-callout-title">Warning</p>');
    expect(warn).toContain('Careful here.');
    expect(warn).not.toContain('[!WARNING]');
  });

  it('opens every link in a new tab with rel=noopener noreferrer', () => {
    const html = render('[x](https://example.com/a) and <https://example.org>');
    const anchors = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('a')];
    expect(anchors).toHaveLength(2);
    for (const a of anchors) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('renders images: bundled paths resolved, external kept, lazy; unknown local images fall back to alt text', () => {
    const html = render('![Local](assets/t/a.jpg)\n\n![Remote](https://upload.wikimedia.org/x.jpg)\n\n![Missing](assets/t/nope.jpg)');
    const imgs = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img')];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['/api/ideas/t/img/a.jpg', 'https://upload.wikimedia.org/x.jpg']);
    for (const i of imgs) {
      expect(i.getAttribute('loading')).toBe('lazy');
    }
    expect(html).toContain('Missing');
    expect(html).not.toContain('nope.jpg');
  });

  it('strips scripts, event handlers, javascript: URLs, iframes, styles and forms', () => {
    const html = render(
      [
        '<script>alert(1)</script>',
        '<img src="x" onerror="alert(2)">',
        '[bad](javascript:alert(3))',
        '<iframe src="https://evil.example"></iframe>',
        '<p style="position:fixed">styled</p>',
        '<form action="https://evil.example"><button>go</button></form>',
        '<a href="https://ok.example" onclick="alert(4)">ok</a>',
      ].join('\n\n'),
    );
    expect(html).not.toMatch(/<script|onerror|onclick|javascript:|<iframe|style=|<form|<button/i);
    expect(html).toContain('https://ok.example');
    expect(html).toContain('styled');
  });

  it('headingId prefixes, normalises and de-duplicates', () => {
    const used = new Map<string, number>();
    expect(headingId('Hotels & Visas', used)).toBe('idea-hotels-and-visas');
    expect(headingId('Hotels & Visas', used)).toBe('idea-hotels-and-visas-2');
    expect(headingId('Åland!!', new Map())).toBe('idea-aland');
    expect(headingId('???', new Map())).toBe('idea-section');
  });
});
