import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CANARIES, GATE_MARKER, PRIVATE_DIR, buildNeedles, privateAssetName, readContent, scanStaticOutput, workerEmbedsContent } from './static-leak-guard.js';

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
    const all = [...Object.values(content.files), ...Object.values(content.pages)].join('\n');
    for (const c of CANARIES.filter((x) => x !== 'Sofitel Ponte 16')) expect(all, c).toContain(c); // 'Sofitel Ponte 16' is a loose variant of 'Sofitel Macau at Ponte 16'
    expect(Object.keys(content.pages).length).toBeGreaterThanOrEqual(1);
    expect(all).toContain('CX 601');
  });
  it('derives many needles from the content, incl. image bytes', () => {
    const n = buildNeedles(content);
    expect(n.filter((x) => x.kind === 'text').length).toBeGreaterThan(20);
    expect(n.filter((x) => x.kind === 'image-bytes').length).toBe(Object.keys(content.images).length);
  });
  it('refuses to pass when there is no content to guard', () => {
    expect(scanStaticOutput(tmp(), { files: {}, pages: {}, images: {} })[0]).toMatch(/vacuously/);
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

describe('private image prefix (brochure images)', () => {
  const [imgKey, imgBytes] = Object.entries(content.images)[0];
  const okName = `${PRIVATE_DIR}/${privateAssetName(imgKey, imgBytes)}`;
  const withGate = (d) => writeFileSync(join(d, '_worker.js'), `function ${GATE_MARKER}p){}`);
  const put = (d, rel, data) => {
    mkdirSync(join(d, rel, '..'), { recursive: true });
    writeFileSync(join(d, rel), data);
  };

  it('names are unguessable content hashes: 32 hex + extension, different per file', () => {
    expect(privateAssetName(imgKey, imgBytes)).toMatch(/^[0-9a-f]{32}\.webp$/);
    const names = Object.entries(content.images).map(([k, b]) => privateAssetName(k, b));
    expect(new Set(names).size).toBe(names.length);
  });

  it('allows exactly the expected image file in the private prefix, when the worker has the gate', () => {
    const d = tmp();
    put(d, okName, imgBytes);
    withGate(d);
    expect(scanStaticOutput(d, content)).toEqual([]);
  });

  it('fails when private images ship without the worker gate (or with no worker at all)', () => {
    const d = tmp();
    put(d, okName, imgBytes);
    expect(scanStaticOutput(d, content).join('\n')).toMatch(/no gate/);
    writeFileSync(join(d, '_worker.js'), 'export default {}');
    expect(scanStaticOutput(d, content).join('\n')).toMatch(/no gate/);
  });

  it('fails on an image copy anywhere else, even under another name or prefix', () => {
    for (const rel of ['assets/photo.webp', '_private/ideas/photo.webp', '_private/photo.webp', `public/${privateAssetName(imgKey, imgBytes)}`]) {
      const d = tmp();
      put(d, rel, imgBytes);
      withGate(d);
      expect(scanStaticOutput(d, content).join('\n'), rel).toMatch(/copy of private image|unexpected file in the private prefix/);
    }
  });

  it('fails on any unexpected file in the private prefix (a page, a map, a stray name)', () => {
    for (const rel of [`${PRIVATE_DIR}/index.html`, `${PRIVATE_DIR}/x.webp`, `${PRIVATE_DIR}/sub/${privateAssetName(imgKey, imgBytes)}`, '_private/readme.txt']) {
      const d = tmp();
      put(d, okName, imgBytes);
      put(d, rel, 'x');
      withGate(d);
      expect(scanStaticOutput(d, content).join('\n'), rel).toMatch(/unexpected file in the private prefix/);
    }
  });

  it('page text and the brochure title are caught in ANY static file, including inside the private prefix', () => {
    const [pageName, html] = Object.entries(content.pages)[0];
    for (const needle of ['CX 601', 'Grand Stanford', 'Sofitel Macau at Ponte 16', 'Hong Kong & Macau Family Adventure']) {
      const d = tmp();
      put(d, 'assets/a.js', `var x="${needle}"`);
      expect(scanStaticOutput(d, content).join('\n'), needle).toContain(needle);
    }
    const d = tmp();
    put(d, 'brochure.html', html);
    put(d, pageName, html);
    expect(scanStaticOutput(d, content).join('\n')).toMatch(/contains text|report markdown\/page file/);
    // text inside an otherwise allowed private image file is still a leak
    const e = tmp();
    put(e, okName, Buffer.concat([imgBytes, Buffer.from('CX 601 Grand Stanford')]));
    withGate(e);
    expect(scanStaticOutput(e, content).join('\n')).toContain('CX 601');
  });

  it('a _routes.json that excludes the private prefix, or does not include it, fails', () => {
    for (const [routes, msg] of [
      [{ version: 1, include: ['/*'], exclude: ['/_private/*'] }, /excludes the private prefix/],
      [{ version: 1, include: ['/*'], exclude: ['/_private/ideas/*'] }, /excludes the private prefix/],
      [{ version: 1, include: ['/*'], exclude: ['/*'] }, /excludes the private prefix/],
      [{ version: 1, include: ['/api/*'], exclude: [] }, /does not include/],
    ]) {
      const d = tmp();
      put(d, okName, imgBytes);
      withGate(d);
      put(d, '_routes.json', JSON.stringify(routes));
      expect(scanStaticOutput(d, content).join('\n')).toMatch(msg);
    }
    const ok = tmp();
    put(ok, okName, imgBytes);
    withGate(ok);
    put(ok, '_routes.json', JSON.stringify({ version: 1, include: ['/*'], exclude: ['/assets/*'] }));
    expect(scanStaticOutput(ok, content)).toEqual([]);
  });
});

describe('workerEmbedsContent', () => {
  it('fails when _worker.js is missing or lacks the embedded reports, passes when embedded', () => {
    const d = tmp();
    expect(workerEmbedsContent(d, content)[0]).toMatch(/missing/);
    writeFileSync(join(d, '_worker.js'), 'export default {}');
    expect(workerEmbedsContent(d, content).join()).toMatch(/not embed/);
    const all = JSON.stringify([...Object.values(content.files), ...Object.values(content.pages)].join('\n'));
    writeFileSync(join(d, '_worker.js'), `const X=${all};`);
    expect(workerEmbedsContent(d, content).join()).toMatch(/no private-prefix gate/);
    writeFileSync(join(d, '_worker.js'), `const X=${all}; function ${GATE_MARKER}p){}`);
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
