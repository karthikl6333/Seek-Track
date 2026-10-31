import { parseIdea, sortIdeas, SLUG_RE, type IdeaMeta, type ParsedIdea } from './frontmatter.js';

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

/** Raw files: `files["<slug>.md"]` = text, `assets["<slug>/<name>"]` = base64 bytes. */
export interface RawIdeaContent {
  files: Record<string, string>;
  assets: Record<string, string>;
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
  for (const [file, text] of Object.entries(raw.files)) {
    try {
      const idea = parseIdea(file, text);
      if (bySlug.has(idea.slug)) throw new Error(`duplicate slug "${idea.slug}"`);
      bySlug.set(idea.slug, idea);
    } catch (e) {
      errors.push({ file, message: e instanceof Error ? e.message : String(e) });
    }
  }
  const assets = new Map(Object.entries(raw.assets));
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
  };
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
  const out: RawIdeaContent = { files: {}, assets: {} };
  if (!root) return out;
  for (const f of readdirSync(root)) {
    if (f.toLowerCase().endsWith('.md') && statSync(join(root, f)).isFile()) {
      out.files[f] = readFileSync(join(root, f), 'utf8');
    }
  }
  const assetsDir = join(root, 'assets');
  if (existsSync(assetsDir)) {
    for (const slug of readdirSync(assetsDir)) {
      const sub = join(assetsDir, slug);
      if (!statSync(sub).isDirectory()) continue;
      for (const name of readdirSync(sub)) {
        if (isValidImageName(name)) out.assets[`${slug}/${name}`] = bytesToBase64(readFileSync(join(sub, name)));
      }
    }
  }
  return out;
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
