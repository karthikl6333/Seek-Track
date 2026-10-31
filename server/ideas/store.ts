import { parseIdea, slugFromPath, sortIdeas, SLUG_RE, type IdeaMeta, type ParsedIdea } from './frontmatter.js';

/**
 * Server-side store for the Ideas reports (privacy: the reports contain personal travel details and
 * research, so they must NEVER be part of the static client bundle or the static output dir; only
 * the authed /api/ideas routes serve them, see routes/ideas.ts).
 *
 * Where the content comes from:
 *  - Node (dev, Docker, Render): read from content/ideas/ on first use.
 *  - Cloudflare Pages: scripts/prepare-cf-pages.js replaces the placeholder below with the content
 *    and bundles everything into the single _worker.js (which is not served as a static file).
 */

/**
 * Where large report images (brochure photos, and Markdown reports' images over EMBED_IMAGE_BYTES) live in
 * the Cloudflare static output. The prefix is PRIVATE even though the
 * files are static assets: the worker never lets a request reach env.ASSETS for it (see the gate in
 * scripts/prepare-cf-pages.js); only the authed /api/ideas/:slug/img route fetches these, server-side.
 */
export const PRIVATE_ASSET_PREFIX = '/_private/ideas';

/** A report whose images total more than this is not embedded in the worker (see readContentFromDisk). */
export const EMBED_IMAGE_BYTES = 64 * 1024;

/**
 * Raw content. `files["<slug>.md"]` = report text, `assets["<slug>/<name>"]` = base64 image bytes (small
 * images, embedded in the worker). Brochures (`format: brochure`) and reports with more than EMBED_IMAGE_BYTES of
 * images are too big to embed: a brochure's HTML is `pages["<slug>.html"]` and its (or the report's) images are
 * `external["<slug>/<name>"]` = a location: a file path in
 * Node, or a PRIVATE_ASSET_PREFIX static path on Cloudflare.
 */
export interface RawIdeaContent {
  files: Record<string, string>;
  assets: Record<string, string>;
  pages?: Record<string, string>;
  external?: Record<string, string>;
}

// @IDEAS_CONTENT_PLACEHOLDER@
const EMBEDDED_IDEAS: RawIdeaContent | null = null;

export const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** Image file names: no path separators, no leading dot, no "..", known image extension only (no SVG). */
export const IMAGE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp|gif)$/i;

export function isValidImageName(name: string): boolean {
  return IMAGE_NAME_RE.test(name) && !name.includes('..') && name.length <= 100;
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && slug.length <= 100;
}

export function imageContentType(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_TYPES[ext] ?? null;
}

export interface IdeaLoadError {
  file: string;
  message: string;
}

export interface IdeaStore {
  /** Metadata, newest first. */
  list: IdeaMeta[];
  errors: IdeaLoadError[];
  get(slug: string): ParsedIdea | null;
  /** Image bytes, or null when the slug/name is invalid or the file does not exist. */
  image(slug: string, name: string): { bytes: Uint8Array; contentType: string } | null;
  /** The brochure page HTML of a `format: brochure` report, else null. */
  page(slug: string): string | null;
  /** A report or brochure image kept outside the worker bundle: where to read it, or null when unknown/invalid. */
  externalImage(slug: string, name: string): { location: string; contentType: string } | null;
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Pure: parses raw content into a store. A bad file is reported in `errors`, never thrown. */
export function buildIdeaStore(raw: RawIdeaContent): IdeaStore {
  const bySlug = new Map<string, ParsedIdea>();
  const errors: IdeaLoadError[] = [];
  const pagesRaw = raw.pages ?? {};
  const externalRaw = raw.external ?? {};
  const pages = new Map<string, string>();
  for (const [file, text] of Object.entries(raw.files)) {
    try {
      const slug = slugFromPath(file);
      const page = pagesRaw[`${slug}.html`];
      const idea = parseIdea(file, text, page);
      if (bySlug.has(idea.slug)) throw new Error(`duplicate slug "${idea.slug}"`);
      if (idea.format === 'brochure') {
        checkBrochureImages(idea.slug, page ?? '', externalRaw);
        pages.set(idea.slug, page ?? '');
      }
      bySlug.set(idea.slug, idea);
    } catch (e) {
      errors.push({ file, message: e instanceof Error ? e.message : String(e) });
    }
  }
  const assets = new Map(Object.entries(raw.assets));
  const external = new Map(Object.entries(externalRaw));
  const list = sortIdeas([...bySlug.values()].map(({ body: _body, ...meta }) => meta));
  return {
    list,
    errors,
    get: (slug) => (isValidSlug(slug) ? (bySlug.get(slug) ?? null) : null),
    image: (slug, name) => {
      const type = imageContentType(name);
      if (!isValidSlug(slug) || !isValidImageName(name) || !type) return null;
      // Only an exact key of the content index can match; the request values never reach a file path.
      const b64 = assets.get(`${slug}/${name}`);
      return b64 === undefined ? null : { bytes: fromBase64(b64), contentType: type };
    },
    page: (slug) => (isValidSlug(slug) ? (pages.get(slug) ?? null) : null),
    externalImage: (slug, name) => {
      const type = imageContentType(name);
      if (!isValidSlug(slug) || !isValidImageName(name) || !type) return null;
      const location = external.get(`${slug}/${name}`);
      return location === undefined ? null : { location, contentType: type };
    },
  };
}

/**
 * A brochure may only use images that ship with it: every <img src> must be "img/<name>" and have a
 * file in content/ideas/assets/<slug>/ (no data: URIs that bloat the worker, no remote images).
 */
function checkBrochureImages(slug: string, html: string, external: Record<string, string>): void {
  for (const m of html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const src = m[1] ?? m[2] ?? '';
    const name = /^img\/([^/?#]+)$/.exec(src)?.[1];
    if (!name || !isValidImageName(name)) {
      throw new Error(`brochure image "${src.slice(0, 40)}" must be a relative "img/<file>" reference, not inline or remote`);
    }
    if (external[`${slug}/${name}`] === undefined) throw new Error(`brochure image "${name}" is missing from content/ideas/assets/${slug}/`);
  }
}

/** Node only: reads content/ideas/*.md and content/ideas/assets/<slug>/<image>. */
export async function readIdeaContentFromDisk(dir?: string): Promise<RawIdeaContent> {
  const { existsSync, readdirSync, readFileSync, statSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = dir
    ? [dir]
    : [join(process.cwd(), 'content', 'ideas'), join(here, '..', '..', 'content', 'ideas')];
  const root = candidates.find((p) => existsSync(p));
  const out: RawIdeaContent = { files: {}, assets: {}, pages: {}, external: {} };
  if (!root) return out;
  for (const f of readdirSync(root)) {
    if (f.toLowerCase().endsWith('.md') && statSync(join(root, f)).isFile()) {
      out.files[f] = readFileSync(join(root, f), 'utf8');
    }
  }
  const pagesDir = join(root, 'pages');
  if (existsSync(pagesDir)) {
    for (const f of readdirSync(pagesDir)) {
      if (f.toLowerCase().endsWith('.html') && statSync(join(pagesDir, f)).isFile()) {
        out.pages![f] = readFileSync(join(pagesDir, f), 'utf8');
      }
    }
  }
  const assetsDir = join(root, 'assets');
  if (existsSync(assetsDir)) {
    for (const slug of readdirSync(assetsDir)) {
      const sub = join(assetsDir, slug);
      if (!statSync(sub).isDirectory()) continue;
      // Brochure images, and the images of any report whose pictures add up to more than
      // EMBED_IMAGE_BYTES, stay outside the worker bundle (disk path in Node, hashed private static file
      // on Cloudflare). Only small image sets are embedded as base64.
      const names = readdirSync(sub).filter((n) => isValidImageName(n));
      const total = names.reduce((a, n) => a + statSync(join(sub, n)).size, 0);
      const external = out.pages![`${slug}.html`] !== undefined || total > EMBED_IMAGE_BYTES;
      for (const name of names) {
        if (external) out.external![`${slug}/${name}`] = join(sub, name);
        else out.assets[`${slug}/${name}`] = bytesToBase64(readFileSync(join(sub, name)));
      }
    }
  }
  return out;
}

/**
 * Reads a brochure image from an `external` location. A location is only ever a value taken from the
 * content index (never from a request): a PRIVATE_ASSET_PREFIX path is fetched from the Pages ASSETS
 * binding; anything else is a file path (Node).
 */
export async function readExternalImage(
  location: string,
  assets: { fetch(request: Request): Promise<Response> } | undefined,
  origin: string,
): Promise<Uint8Array | null> {
  if (location.startsWith(`${PRIVATE_ASSET_PREFIX}/`)) {
    if (!assets) return null;
    const res = await assets.fetch(new Request(new URL(location, origin), { redirect: 'manual' }));
    return res.status === 200 ? new Uint8Array(await res.arrayBuffer()) : null;
  }
  const { readFile } = await import('node:fs/promises');
  try {
    return new Uint8Array(await readFile(location));
  } catch {
    return null;
  }
}

let cached: Promise<IdeaStore> | null = null;

/** The process-wide store (embedded content when built for Workers, else content/ideas on disk). */
export function getIdeaStore(): Promise<IdeaStore> {
  cached ??= (async () => buildIdeaStore(EMBEDDED_IDEAS ?? (await readIdeaContentFromDisk())))().catch((err) => {
    cached = null; // do not cache a failure
    throw err;
  });
  return cached;
}

/** For tests: replace (or clear, with null) the process-wide store. */
export function setIdeaStoreForTests(store: IdeaStore | null): void {
  cached = store ? Promise.resolve(store) : null;
}
