/**
 * Privacy guard for the Cloudflare Pages output (dist-cf).
 *
 * Everything in dist-cf except _worker.js is a PUBLIC static asset (only /api/* sits behind Basic auth).
 * The Ideas reports (content/ideas/) contain private family/travel details, so they must live only
 * inside _worker.js (never served) and be reachable only through the authed /api/ideas routes.
 *
 * This module is used by scripts/prepare-cf-pages.js (fails build:cf) and by
 * scripts/static-leak-guard.test.ts. It has no dependencies beyond node:*.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Hand-picked canaries that must never reach the static output, on top of the derived needles. */
export const CANARIES = ['CX 601', 'Grand Stanford', 'Boosted Breeding'];

/** Files that are not served as static assets by Cloudflare Pages advanced mode. */
export const NOT_SERVED = new Set(['_worker.js']);

/** Read content/ideas into { files: {name: text}, images: {"slug/name": Buffer} } (for the guard only). */
export function readContent(contentDir) {
  const files = {};
  const images = {};
  if (!existsSync(contentDir)) return { files, images };
  for (const name of readdirSync(contentDir)) {
    if (name.endsWith('.md')) files[name] = readFileSync(join(contentDir, name), 'utf8');
  }
  const assets = join(contentDir, 'assets');
  if (existsSync(assets)) {
    for (const slug of readdirSync(assets)) {
      const sub = join(assets, slug);
      if (!statSync(sub).isDirectory()) continue;
      for (const name of readdirSync(sub)) images[`${slug}/${name}`] = readFileSync(join(sub, name));
    }
  }
  return { files, images };
}

/**
 * Needles (Buffers) that identify private report content wherever it ends up in a file:
 * the canaries, each report's title, and one distinctive plain-text run from every long line
 * (the longest run of characters that survive HTML/JS/JSON escaping unchanged). Images are
 * identified by their first 60 bytes (raw and base64) and file names.
 */
export function buildNeedles(content) {
  const text = new Set(CANARIES);
  for (const md of Object.values(content.files)) {
    const title = /^title:\s*(.+)$/m.exec(md)?.[1]?.trim().replace(/^["']|["']$/g, '');
    if (title && title.length >= 8) text.add(title);
    for (const line of md.split(/\r?\n/)) {
      const runs = line.match(/[A-Za-z0-9 ,.()\-:;/+]{40,}/g) ?? [];
      if (runs.length) text.add(runs.sort((a, b) => b.length - a.length)[0].trim());
    }
  }
  const needles = [...text].filter((t) => t.length >= 6).map((t) => ({ kind: 'text', label: t, buf: Buffer.from(t, 'utf8') }));
  for (const [key, bytes] of Object.entries(content.images)) {
    const head = bytes.subarray(0, 60);
    needles.push({ kind: 'image-bytes', label: key, buf: Buffer.from(head) });
    needles.push({ kind: 'image-base64', label: key, buf: Buffer.from(head.toString('base64'), 'ascii') });
  }
  return needles;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/**
 * Scan the static output dir. Returns a list of human-readable problems (empty = clean).
 * `content` is what readContent() returns for content/ideas.
 */
export function scanStaticOutput(outDir, content) {
  const problems = [];
  if (Object.keys(content.files).length === 0) {
    return ['no report content found to guard (content/ideas is empty): the guard would pass vacuously'];
  }
  const needles = buildNeedles(content);
  const imageHashes = new Map(Object.entries(content.images).map(([k, b]) => [createHash('sha256').update(b).digest('hex'), k]));
  const reportNames = new Set(Object.keys(content.files));
  for (const file of walk(outDir)) {
    const rel = relative(outDir, file).split(sep).join('/');
    if (NOT_SERVED.has(rel)) continue;
    if (rel.startsWith('dist-server/') || rel.startsWith('content/')) problems.push(`${rel}: server/content directory shipped as a static asset`);
    if (rel.endsWith('.map') || /\.test\.js$/.test(rel)) problems.push(`${rel}: source map or test file in the static output`);
    if (reportNames.has(rel.split('/').pop())) problems.push(`${rel}: report markdown file in the static output`);
    const buf = readFileSync(file);
    const img = imageHashes.get(createHash('sha256').update(buf).digest('hex'));
    if (img) problems.push(`${rel}: is a copy of private image ${img}`);
    for (const n of needles) {
      if (buf.includes(n.buf)) problems.push(`${rel}: contains ${n.kind} of private content "${n.label.slice(0, 60)}"`);
    }
  }
  return problems;
}

/** Positive check: the worker bundle really embeds the content (so the API can serve it). */
export function workerEmbedsContent(outDir, content) {
  const p = join(outDir, '_worker.js');
  if (!existsSync(p)) return ['_worker.js is missing'];
  const buf = readFileSync(p);
  const problems = [];
  for (const c of CANARIES) {
    // Only require canaries that exist in the source content.
    const inSource = Object.values(content.files).some((md) => md.includes(c));
    if (inSource && !buf.includes(Buffer.from(c))) problems.push(`_worker.js does not embed "${c}" (ideas content not embedded)`);
  }
  if (/@IDEAS_CONTENT_PLACEHOLDER@/.test(buf.toString('utf8'))) problems.push('_worker.js still contains the ideas placeholder');
  return problems;
}
