/**
 * Ideas (research reports): pure helpers. Reports are Markdown files with a small frontmatter
 * block under src/content/ideas/, bundled at build time (see src/content/ideas/index.ts).
 * No DOM and no I/O here, so everything is unit tested in node.
 */

export interface Idea {
  /** URL slug: the file name without ".md". Used in the deep link "#ideas/<slug>". */
  slug: string;
  title: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  summary: string;
  tags: string[];
  /** Optional link to where the report came from. */
  source?: string;
  /** Markdown body (frontmatter removed). */
  body: string;
}

export interface IdeaLoadError {
  path: string;
  message: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Frontmatter keys -> raw values, plus the remaining body. Accepts LF or CRLF. */
export function splitFrontmatter(raw: string): { data: Record<string, string | string[]>; body: string } {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) throw new Error('missing frontmatter block (--- ... ---) at the top of the file');
  const data: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`cannot parse frontmatter line: ${line}`);
    const [, key, value] = kv;
    listKey = null;
    if (value === '') {
      data[key] = [];
      listKey = key; // "key:" followed by "- item" lines
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = splitList(value.slice(1, -1));
    } else {
      data[key] = unquote(value.trim());
    }
  }
  return { data, body: text.slice(m[0].length).replace(/^\n+/, '') };
}

function unquote(v: string): string {
  const s = v.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function splitList(inner: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(unquote).filter(Boolean);
}

export function slugFromPath(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
}

/** Parses one report file. Throws a readable Error when a required field is missing or malformed. */
export function parseIdea(path: string, raw: string): Idea {
  const slug = slugFromPath(path);
  if (!SLUG_RE.test(slug)) throw new Error(`file name must be lowercase letters, digits and dashes: "${slug}"`);
  const { data, body } = splitFrontmatter(raw);
  const str = (k: string): string => {
    const v = data[k];
    return typeof v === 'string' ? v.trim() : '';
  };
  const title = str('title');
  if (!title) throw new Error('frontmatter "title" is required');
  const date = str('date');
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error('frontmatter "date" must be a valid YYYY-MM-DD date');
  }
  const summary = str('summary');
  if (!summary) throw new Error('frontmatter "summary" is required');
  const rawTags = data.tags;
  const tagList = Array.isArray(rawTags) ? rawTags : typeof rawTags === 'string' ? splitList(rawTags) : [];
  const tags = dedupeTags(tagList);
  const source = str('source');
  if (source && !/^https?:\/\//i.test(source)) throw new Error('frontmatter "source" must be an http(s) URL');
  return { slug, title, date, summary, tags, ...(source ? { source } : {}), body };
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags.map((x) => x.trim()).filter(Boolean)) {
    const k = t.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

/** Newest date first; ties by title so the order is stable. */
export function sortIdeas<T extends Pick<Idea, 'date' | 'title'>>(ideas: readonly T[]): T[] {
  return [...ideas].sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : a.date < b.date ? 1 : -1));
}

/** Parses a { path: rawText } map (what import.meta.glob returns). Bad files are reported, not thrown. */
export function loadIdeas(files: Record<string, string>): { ideas: Idea[]; errors: IdeaLoadError[] } {
  const ideas: Idea[] = [];
  const errors: IdeaLoadError[] = [];
  const seen = new Set<string>();
  for (const [path, raw] of Object.entries(files)) {
    try {
      const idea = parseIdea(path, raw);
      if (seen.has(idea.slug)) throw new Error(`duplicate slug "${idea.slug}"`);
      seen.add(idea.slug);
      ideas.push(idea);
    } catch (e) {
      errors.push({ path, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ideas: sortIdeas(ideas), errors };
}

export interface TagCount {
  tag: string;
  count: number;
}

/** Tags with counts, most used first, then alphabetical (case-insensitive). */
export function tagCounts(ideas: readonly Idea[]): TagCount[] {
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
export function filterIdeas(ideas: readonly Idea[], tags: ReadonlySet<string>, query: string): Idea[] {
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

/** "2026-10-31" -> "31 Oct 2026" (fixed format, no locale or time zone dependence). */
export function formatIdeaDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** Rough reading time from the Markdown body (about 220 words per minute, at least 1). */
export function readingMinutes(body: string): number {
  const words = body.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
