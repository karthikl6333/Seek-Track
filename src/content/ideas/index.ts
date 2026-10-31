import { loadIdeas } from '../../lib/ideas';

/**
 * Every report is a Markdown file in this folder (docs/ADDING_IDEAS.md). They are bundled at build
 * time as raw strings; nothing is fetched at runtime and no URL path is involved.
 */
const files = import.meta.glob('./*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Images referenced from a report as `assets/<folder>/<file>`; Vite fingerprints and serves them. */
const assetUrls = import.meta.glob('./assets/**/*.{jpg,jpeg,png,webp,gif,svg}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const { ideas: IDEAS, errors: IDEA_ERRORS } = loadIdeas(files);

/** "assets/trip/cover.jpg" -> bundled URL, or null when the file does not exist. */
export function resolveIdeaAsset(ref: string): string | null {
  const key = './' + ref.replace(/^\.?\//, '');
  return assetUrls[key] ?? null;
}

/** For tests: every asset path that exists in the bundle. */
export const IDEA_ASSET_KEYS = Object.keys(assetUrls);
