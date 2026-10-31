/**
 * Privacy guard for the Cloudflare Pages output (dist-cf).
 *
 * Everything in dist-cf except _worker.js is a PUBLIC static asset (only /api/* sits behind Basic auth).
 * The Ideas reports (content/ideas/) contain private family/travel details, so they must live only
 * inside _worker.js (never served) and be reachable only through the authed /api/ideas routes.
 *
 * One exception: brochure IMAGES (too big for the worker bundle) may sit in the static output, but only
 * under the private prefix PRIVATE_DIR, with the exact content-hash names privateAssetName() produces, and
 * only while the worker carries the gate that stops requests from reaching them (GATE_MARKER). Page text is
 * never allowed in any static file.
 *
 * This module is used by scripts/prepare-cf-pages.js (fails build:cf) and by
 * scripts/static-leak-guard.test.ts. It has no dependencies beyond node:*.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

/** Hand-picked canaries that must never reach the static output, on top of the derived needles. */
export const CANARIES = ['CX 601', 'Grand Stanford', 'Sofitel Ponte 16', 'Sofitel Macau at Ponte 16', 'Karthik, his wife', 'Hong Kong & Macau Family Adventure', 'Boosted Breeding', 'AI Camera System for Retail Theft Patterns', '₹451.8 crore', 'Edge, Central or Hybrid', 'Where the loss comes from', '$55.7B', 'Unpaid items at the exit?', 'The gene-edit pipeline and where Indian rules bite'];

/** The only static directory allowed to hold (brochure) image bytes. Must match PRIVATE_ASSET_PREFIX in server/ideas/store.ts. */
export const PRIVATE_DIR = '_private/ideas';

/** Present in _worker.js when the private-prefix gate is bundled (see scripts/prepare-cf-pages.js). */
export const GATE_MARKER = 'isPrivatePath(';

/** Unguessable static file name for a brochure image: sha256("<slug>/<name>\0" + bytes), 32 hex chars, same extension. */
export function privateAssetName(key, bytes) {
  const hash = createHash('sha256').update(`${key}\0`).update(bytes).digest('hex').slice(0, 32);
  return `${hash}${extname(key).toLowerCase()}`;
}

/**
 * The text itself plus its JSON/JS-escaped spelling ("\u20B9" for "₹", upper and lower case hex): the
 * worker bundler may write non-ASCII characters as escapes, and a leak could be escaped the same way.
 */
export function escapedForms(t) {
  if (!/[^\x00-\x7f]/.test(t)) return [t];
  const esc = (hex) => t.replace(/[^\x00-\x7f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')[hex]()}`);
  return [...new Set([t, esc('toUpperCase'), esc('toLowerCase')])];
}

/** Files that are not served as static assets by Cloudflare Pages advanced mode. */
export const NOT_SERVED = new Set(['_worker.js']);

/** Read content/ideas into { files: {name: text}, pages: {name: html}, images: {"slug/name": Buffer} } (for the guard only). */
export function readContent(contentDir) {
  const files = {};
  const pages = {};
  const images = {};
  if (!existsSync(contentDir)) return { files, pages, images };
  for (const name of readdirSync(contentDir)) {
    if (name.endsWith('.md')) files[name] = readFileSync(join(contentDir, name), 'utf8');
  }
  const pagesDir = join(contentDir, 'pages');
  if (existsSync(pagesDir)) {
    for (const name of readdirSync(pagesDir)) {
      if (name.endsWith('.html')) pages[name] = readFileSync(join(pagesDir, name), 'utf8');
    }
  }
  const assets = join(contentDir, 'assets');
  if (existsSync(assets)) {
    for (const slug of readdirSync(assets)) {
      const sub = join(assets, slug);
      if (!statSync(sub).isDirectory()) continue;
      for (const name of readdirSync(sub)) images[`${slug}/${name}`] = readFileSync(join(sub, name));
    }
  }
  return { files, pages, images };
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
  // Brochure pages: the title and a sample of long visible text runs (from the text between tags).
  for (const html of Object.values(content.pages ?? {})) {
    const title = /<title>([^<]+)<\/title>/i.exec(html)?.[1]?.replace(/&amp;/g, '&').trim();
    if (title && title.length >= 8) text.add(title);
    const pageRuns = [];
    for (const node of html.replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, '').matchAll(/>([^<]{40,})</g)) {
      const run = (node[1].match(/[A-Za-z0-9 ,.()\-:;/+]{40,}/g) ?? []).sort((a, b) => b.length - a.length)[0];
      if (run) pageRuns.push(run.trim());
    }
    // Evenly spaced sample, at most 150 runs, so scanning stays fast but covers the whole page.
    const step = Math.max(1, Math.ceil(pageRuns.length / 150));
    pageRuns.filter((_, i) => i % step === 0).forEach((r) => text.add(r));
  }
  const needles = [...text]
    .filter((t) => t.length >= 6)
    .flatMap((t) => escapedForms(t).map((form) => ({ kind: 'text', label: t, buf: Buffer.from(form, 'utf8') })));
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
  // The ONLY image files allowed in the static output: exact private names under PRIVATE_DIR.
  const allowedPrivate = new Set(Object.entries(content.images).map(([k, b]) => `${PRIVATE_DIR}/${privateAssetName(k, b)}`));
  const reportNames = new Set(Object.keys(content.files));
  const pageNames = new Set(Object.keys(content.pages ?? {}));
  let privateFiles = 0;
  for (const file of walk(outDir)) {
    const rel = relative(outDir, file).split(sep).join('/');
    if (NOT_SERVED.has(rel)) continue;
    if (rel.startsWith('dist-server/') || rel.startsWith('content/')) problems.push(`${rel}: server/content directory shipped as a static asset`);
    if (rel.endsWith('.map') || /\.test\.js$/.test(rel)) problems.push(`${rel}: source map or test file in the static output`);
    const base = rel.split('/').pop();
    if (reportNames.has(base) || pageNames.has(base)) problems.push(`${rel}: report markdown/page file in the static output`);
    const inPrivate = rel === PRIVATE_DIR || rel.startsWith(`${PRIVATE_DIR}/`) || rel.startsWith('_private/');
    const allowed = allowedPrivate.has(rel);
    if (inPrivate && !allowed) problems.push(`${rel}: unexpected file in the private prefix (only content-hash image names are allowed)`);
    if (allowed) privateFiles++;
    const buf = readFileSync(file);
    const img = imageHashes.get(createHash('sha256').update(buf).digest('hex'));
    if (img && !allowed) problems.push(`${rel}: is a copy of private image ${img} outside the private prefix`);
    for (const n of needles) {
      // An allowed private image is binary: its own header bytes are expected there, text never is.
      if (allowed && n.kind !== 'text') continue;
      if (buf.includes(n.buf)) problems.push(`${rel}: contains ${n.kind} of private content "${n.label.slice(0, 60)}"`);
    }
  }
  if (privateFiles > 0) {
    // Private files are only safe while nothing can serve them directly.
    const worker = join(outDir, '_worker.js');
    if (!existsSync(worker) || !readFileSync(worker, 'utf8').includes(GATE_MARKER)) {
      problems.push(`${PRIVATE_DIR}: private images are shipped but _worker.js has no gate (${GATE_MARKER}) in front of env.ASSETS`);
    }
    const routes = join(outDir, '_routes.json');
    if (existsSync(routes)) {
      // A _routes.json "exclude" makes Cloudflare serve those paths WITHOUT running the worker.
      try {
        const r = JSON.parse(readFileSync(routes, 'utf8'));
        const includes = r.include ?? [];
        const excludes = r.exclude ?? [];
        const covers = (pat) => pat === '/*' || pat === '/_private/*' || pat === '/_private/ideas/*' || pat === '/_private' || pat.startsWith('/_private/');
        if (excludes.some(covers)) problems.push('_routes.json excludes the private prefix, so Cloudflare would serve it without running the worker');
        if (!includes.some((p) => p === '/*' || p === '/_private/*')) problems.push('_routes.json does not include /* or /_private/*: the worker would not run for the private prefix');
      } catch {
        problems.push('_routes.json is not valid JSON');
      }
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
    const inSource = [...Object.values(content.files), ...Object.values(content.pages ?? {})].some((t) => t.includes(c));
    if (inSource && !escapedForms(c).some((form) => buf.includes(Buffer.from(form)))) problems.push(`_worker.js does not embed "${c}" (ideas content not embedded)`);
  }
  if (Object.keys(content.pages ?? {}).length > 0 && !buf.includes(Buffer.from(GATE_MARKER))) {
    problems.push(`_worker.js has no private-prefix gate (${GATE_MARKER})`);
  }
  if (/@IDEAS_CONTENT_PLACEHOLDER@/.test(buf.toString('utf8'))) problems.push('_worker.js still contains the ideas placeholder');
  return problems;
}
