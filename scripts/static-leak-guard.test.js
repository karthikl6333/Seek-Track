import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CANARIES, buildNeedles, readContent, scanStaticOutput, workerEmbedsContent } from './static-leak-guard.js';

const contentDir = join(process.cwd(), 'content', 'ideas');
const content = readContent(contentDir);
const dirs = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'leak-guard-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('guard inputs are real (not vacuous)', () => {
  it('every canary exists in the report content and there are reports and images', () => {
    expect(Object.keys(content.files).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(content.images).length).toBeGreaterThan(0);
    const all = Object.values(content.files).join('\n');
    for (const c of CANARIES) expect(all, c).toContain(c);
  });
  it('derives many needles from the content, incl. image bytes', () => {
    const n = buildNeedles(content);
    expect(n.filter((x) => x.kind === 'text').length).toBeGreaterThan(20);
    expect(n.filter((x) => x.kind === 'image-bytes').length).toBe(Object.keys(content.images).length);
  });
  it('refuses to pass when there is no content to guard', () => {
    expect(scanStaticOutput(tmp(), { files: {}, images: {} })[0]).toMatch(/vacuously/);
  });
});

describe('scanStaticOutput catches leaks', () => {
  const [mdName, md] = Object.entries(content.files)[0];
  const [imgKey, imgBytes] = Object.entries(content.images)[0];

  it('passes a clean output dir (and ignores _worker.js, which is never served)', () => {
    const d = tmp();
    mkdirSync(join(d, 'assets'));
    writeFileSync(join(d, 'index.html'), '<html></html>');
    writeFileSync(join(d, 'assets', 'app.js'), 'console.log("hello")');
    writeFileSync(join(d, '_worker.js'), md); // allowed: not served
    expect(scanStaticOutput(d, content)).toEqual([]);
  });
  it.each(CANARIES)('fails when the canary %s appears in a static JS file', (c) => {
    const d = tmp();
    mkdirSync(join(d, 'assets'));
    writeFileSync(join(d, 'assets', 'Ideas-abc.js'), `var x="${c}";`);
    expect(scanStaticOutput(d, content).join('\n')).toContain(c);
  });
  it('fails when a long report line is bundled (old behaviour: markdown inlined into JS)', () => {
    const d = tmp();
    mkdirSync(join(d, 'assets'));
    writeFileSync(join(d, 'assets', 'Ideas-abc.js'), `export default ${JSON.stringify(md)};`);
    expect(scanStaticOutput(d, content).length).toBeGreaterThan(0);
  });
  it('fails on an image copy, an inlined base64 image, a dist-server dir, a map and a report .md', () => {
    const d = tmp();
    mkdirSync(join(d, 'assets'));
    mkdirSync(join(d, 'dist-server'));
    writeFileSync(join(d, 'assets', 'hashed-name.jpg'), imgBytes);
    writeFileSync(join(d, 'assets', 'inline.js'), `x="data:image/jpeg;base64,${imgBytes.toString('base64')}"`);
    writeFileSync(join(d, 'dist-server', 'index.js'), '1');
    writeFileSync(join(d, 'assets', 'a.js.map'), '{}');
    writeFileSync(join(d, mdName), 'x');
    const out = scanStaticOutput(d, content).join('\n');
    expect(out).toContain(`copy of private image ${imgKey}`);
    expect(out).toContain('image-base64');
    expect(out).toContain('dist-server/index.js');
    expect(out).toContain('a.js.map');
    expect(out).toContain(`${mdName}: report markdown`);
  });
});

describe('workerEmbedsContent', () => {
  it('fails when _worker.js is missing or lacks the embedded reports, passes when embedded', () => {
    const d = tmp();
    expect(workerEmbedsContent(d, content)[0]).toMatch(/missing/);
    writeFileSync(join(d, '_worker.js'), 'export default {}');
    expect(workerEmbedsContent(d, content).join()).toMatch(/not embed/);
    writeFileSync(join(d, '_worker.js'), `const X=${JSON.stringify(Object.values(content.files).join('\n'))};`);
    expect(workerEmbedsContent(d, content)).toEqual([]);
  });
});

// Runs on the real build output whenever `npm run build:cf` has been run (the build itself also runs this guard).
const cf = join(process.cwd(), 'dist-cf');
describe.skipIf(!existsSync(join(cf, '_worker.js')))('real dist-cf output', () => {
  it('has no report text or images in the static output and embeds them in _worker.js', () => {
    expect(scanStaticOutput(cf, content)).toEqual([]);
    expect(workerEmbedsContent(cf, content)).toEqual([]);
    expect(existsSync(join(cf, 'dist-server'))).toBe(false);
    expect(readFileSync(join(cf, '_worker.js'), 'utf8')).not.toMatch(/sourceMappingURL/);
  });
});
