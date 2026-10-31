// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSanitizer, renderIdeaMarkdown } from './markdown';
import { renderViz, vizTexts } from './viz';

const sanitize = createSanitizer(window);
const json = (o: unknown) => JSON.stringify(o);
const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html');

const specs: Record<string, unknown> = {
  bar: { type: 'bar', title: 'T', items: [{ label: 'A', value: 10, display: '10%' }, { label: 'B', value: 5, display: '5%', estimate: true }] },
  grouped: { type: 'bar', series: ['One', 'Two'], items: [{ label: 'A', values: [4, 8], displays: ['$4', '$8'] }] },
  stacked: { type: 'stacked', rows: [{ label: 'R', parts: [{ label: 'a', value: 25, display: '25%' }, { label: 'b', value: 75, display: '75%' }] }] },
  funnel: {
    type: 'funnel',
    columns: [{ heading: 'H', levels: [{ tag: 'TAM', value: '$5B', label: 'all', status: 'Sourced' }, { tag: 'SAM', value: '$1B', label: 'part', estimate: true }] }],
  },
  circles: { type: 'circles', items: [{ tag: 'TAM', value: 100, display: '100' }, { tag: 'SAM', value: 40, display: '40', estimate: true }] },
  line: { type: 'line', points: [{ x: '2025', y: 1, display: '$1B' }, { x: '2026', y: 2, display: '$2B', estimate: true }, { x: '2027', y: 4, display: '$4B' }] },
  scatter: { type: 'scatter', xLabel: 'X', yLabel: 'Y', points: [{ label: 'P', x: 0.2, y: 0.8 }, { label: 'Q', x: 0.9, y: 0.1 }] },
  flow: {
    type: 'flow',
    nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0, kind: 'decision' }, { id: 'c', label: 'C', col: 2, row: 0 }],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', label: 'yes' }, { from: 'c', to: 'a', dashed: true }],
  },
};

describe('renderViz', () => {
  it.each(Object.entries(specs))('renders a %s chart as an accessible inline svg with no style or script', (_n, spec) => {
    const html = renderViz(json(spec));
    expect(html).toMatch(/^<figure class="idea-viz /);
    expect(html).toContain('<svg');
    expect(html).toContain('role="img"');
    expect(html).not.toMatch(/style=|<script|<foreignObject|javascript:/i);
  });

  it('escapes every user-controlled string', () => {
    const evil = '<img src=x onerror=alert(1)>"&';
    const html = renderViz(json({ type: 'bar', title: evil, note: evil, items: [{ label: evil, value: 1, display: evil }] }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it.each([
    ['not json', '{nope', /invalid JSON/],
    ['not an object', '[1]', /must be an object/],
    ['no type', '{"items":[]}', /unknown viz type "undefined"/],
    ['unknown type', '{"type":"pie"}', /unknown viz type "pie"/],
    ['empty items', '{"type":"bar","items":[]}', /items/],
    ['too many columns', json({ type: 'funnel', columns: [1, 2, 3, 4].map(() => ({ heading: 'h', levels: [] })) }), /columns/],
    ['flow edge to a missing node', json({ type: 'flow', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0 }], edges: [{ from: 'a', to: 'zzz' }] }), /unknown node/],
    ['oversized', ' '.repeat(20001), /too large/],
  ])('rejects %s with a readable error', (_n, src, msg) => {
    expect(() => renderViz(src)).toThrow(msg);
  });

  it('labels estimates: dashed or hollow marks plus a title', () => {
    expect(renderViz(json(specs.funnel))).toContain('viz-est');
    expect(renderViz(json(specs.line))).toContain('viz-dot-est');
    expect(renderViz(json(specs.bar))).toContain('viz-est');
  });

  it('vizTexts returns the display strings only', () => {
    expect(vizTexts(json(specs.bar))).toEqual(expect.arrayContaining(['10%', '5%', 'A', 'B']));
  });
});

describe('viz blocks in the markdown pipeline', () => {
  const md = (body: string) => sanitize(renderIdeaMarkdown(body, () => null).html);

  it('turns a ```viz block into an svg figure that survives the sanitizer (and keeps its <title> tooltips)', () => {
    const html = md('## S\n\n```viz\n' + json(specs.funnel) + '\n```\n\nafter');
    const d = doc(html);
    expect(d.querySelector('figure.idea-viz svg')).toBeTruthy();
    expect(d.querySelectorAll('polygon').length).toBe(2);
    expect(d.querySelector('svg title')).toBeTruthy();
    expect(d.querySelector('figure svg text')).toBeTruthy();
    expect(html).toContain('after');
  });

  it('keeps flow edges (polylines), arrowheads and node shapes', () => {
    const d = doc(md('```viz\n' + json(specs.flow) + '\n```'));
    expect(d.querySelectorAll('svg polyline').length).toBe(3);
    expect(d.querySelectorAll('svg polygon').length).toBeGreaterThanOrEqual(1); // arrowheads and the decision node
  });

  it('shows the error, not a broken page, for a bad spec; other blocks keep rendering', () => {
    const html = md('```viz\n{bad\n```\n\n```viz\n' + json(specs.bar) + '\n```\n\n```js\nlet x = 1\n```');
    expect(html).toContain('idea-viz-error');
    expect(html).toContain('Chart error');
    expect(doc(html).querySelector('figure.idea-viz svg')).toBeTruthy();
    expect(html).toContain('let x = 1'); // other languages are untouched
  });

  it('a hostile spec cannot inject script or event handlers through the sanitizer', () => {
    const evil = '"><script>alert(1)</script><svg onload=alert(1)>';
    const html = md('```viz\n' + json({ type: 'bar', title: evil, items: [{ label: evil, value: 1, display: evil }] }) + '\n```');
    const d = doc(html);
    expect(d.querySelectorAll('script').length).toBe(0);
    expect(d.querySelectorAll('svg svg').length).toBe(0);
    expect([...d.querySelectorAll('*')].some((el) => [...el.attributes].some((a) => /^on/i.test(a.name)))).toBe(false);
    expect(d.body.textContent).toContain('alert(1)'); // shown as text, not run
  });
});

// Every chart in the bundled reports renders, and every number it shows comes from the report text.
describe('bundled reports: charts', () => {
  const dir = join(process.cwd(), 'content', 'ideas');
  const reports = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const blocks = (src: string) => [...src.matchAll(/```viz\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  const reportsWithCharts = reports.filter((f) => blocks(readFileSync(join(dir, f), 'utf8')).length > 0);

  it('both visualised reports are present', () => {
    expect(reportsWithCharts).toEqual(expect.arrayContaining(['ai-retail-theft-camera.md', 'boosted-breeding-in-agriculture.md']));
  });

  it.each(reportsWithCharts)('%s: every chart renders without error and its numbers appear in the report', (file) => {
    const src = readFileSync(join(dir, file), 'utf8');
    const prose = src.replace(/```viz\n[\s\S]*?\n```/g, '');
    const proseNorm = prose.replace(/,/g, '');
    const html = sanitize(renderIdeaMarkdown(src.replace(/^---[\s\S]*?\n---\n/, ''), () => '/x.webp').html);
    expect(html).not.toContain('idea-viz-error');
    expect(doc(html).querySelectorAll('figure.idea-viz').length).toBe(blocks(src).length);
    const missing: string[] = [];
    for (const b of blocks(src)) {
      for (const t of vizTexts(b)) {
        for (const num of t.match(/\d[\d.]*\d|\d/g) ?? []) {
          if (!proseNorm.includes(num)) missing.push(`${num} in "${t}"`);
        }
      }
    }
    // A figure on a chart that is not in the text is a number we invented: none allowed, except a short explicit allow-list of derived scenario labels.
    expect(missing).toEqual([]);
  });
});
