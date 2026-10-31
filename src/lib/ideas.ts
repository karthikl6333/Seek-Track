/**
 * Ideas (research reports): pure client helpers. The reports themselves live on the server
 * (content/ideas/, served by the authed /api/ideas routes); they are never part of the static
 * client bundle. No DOM and no I/O here, so everything is unit tested in node.
 */

/** List entry from GET /api/ideas. */
export interface IdeaMeta {
  /** URL slug, used in the deep link "#ideas/<slug>". */
  slug: string;
  title: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  summary: string;
  tags: string[];
  /** Reading time in minutes. */
  minutes: number;
  /** "markdown": rendered by the app. "brochure": a full HTML page shown in a sandboxed iframe. */
  format: IdeaFormat;
}

export type IdeaFormat = 'markdown' | 'brochure';

/** One report from GET /api/ideas/:slug. */
export interface Idea extends IdeaMeta {
  /** Markdown body (frontmatter removed). */
  body: string;
}

export interface IdeaListResponse {
  ideas: IdeaMeta[];
  /** Report files the server could not read (they are hidden). */
  errors: Array<{ file: string; message: string }>;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** URL of a brochure report's HTML page (authed; same origin as the app, or API_BASE in dev). Null for a bad slug. */
export function ideaPageUrl(slug: string, base = ''): string | null {
  return SLUG_RE.test(slug) && slug.length <= 100 ? `${base}/api/ideas/${slug}/page` : null;
}

/**
 * Sandbox for the brochure iframe. Scripts (its photo slideshows) and popups (external links open in a
 * new, normal tab) only; NOT allow-same-origin, so the page runs in an opaque origin and cannot touch the
 * app, its storage or its API.
 */
export const BROCHURE_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';

export interface TagCount {
  tag: string;
  count: number;
}

/** Tags with counts, most used first, then alphabetical (case-insensitive). */
export function tagCounts(ideas: readonly IdeaMeta[]): TagCount[] {
  const map = new Map<string, TagCount>();
  for (const i of ideas) {
    for (const tag of i.tags) {
      const k = tag.toLowerCase();
      const cur = map.get(k);
      if (cur) cur.count += 1;
      else map.set(k, { tag, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Tag filter is AND across the selected tags; search is every word found in title, summary or tags. */
export function filterIdeas<T extends IdeaMeta>(ideas: readonly T[], tags: ReadonlySet<string>, query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return ideas.filter((i) => {
    const own = new Set(i.tags.map((t) => t.toLowerCase()));
    for (const t of tags) if (!own.has(t.toLowerCase())) return false;
    if (words.length === 0) return true;
    const hay = `${i.title} ${i.summary} ${i.tags.join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** "#ideas/my-report" -> "my-report"; "#ideas", "#overview" or a malformed slug -> null. */
export function ideaSlugFromHash(hash: string): string | null {
  const m = /^#\/?ideas\/([^/?#]+)/.exec(hash || '');
  if (!m) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return SLUG_RE.test(slug) ? slug : null;
}

export function ideaHash(slug: string | null): string {
  return slug ? `#ideas/${slug}` : '#ideas';
}

/**
 * Report image reference -> authed API URL. Reports reference images as "assets/<slug>/<file>"
 * (see docs/ADDING_IDEAS.md); the server serves them at /api/ideas/<slug>/img/<file>. Anything else
 * (unknown shape) -> null, which the renderer shows as the alt text.
 */
export function ideaAssetUrl(ref: string, base = ''): string | null {
  const m = /^\.?\/?assets\/([a-z0-9][a-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp|gif))$/i.exec(ref);
  if (!m || m[1] !== m[1].toLowerCase() || m[2].includes('..')) return null;
  return `${base}/api/ideas/${m[1]}/img/${m[2]}`;
}

/** "2026-10-31" -> "31 Oct 2026" (fixed format, no locale or time zone dependence). */
export function formatIdeaDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}
