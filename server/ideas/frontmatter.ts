/**
 * Ideas (research reports): frontmatter parsing. Reports are Markdown files with a small YAML-subset
 * header under content/ideas/ (docs/ADDING_IDEAS.md). Pure functions, no I/O.
 */

/** How a report is presented: Markdown rendered by the app, or a self-contained HTML brochure page shown in a sandboxed iframe. */
export type IdeaFormat = 'markdown' | 'brochure';
export const IDEA_FORMATS: readonly IdeaFormat[] = ['markdown', 'brochure'];

export interface IdeaMeta {
  /** URL slug: the file name without ".md". Used in "#ideas/<slug>" and "/api/ideas/<slug>". */
  slug: string;
  title: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  summary: string;
  tags: string[];
  /** Rough reading time in minutes (about 220 words per minute, at least 1). */
  minutes: number;
  format: IdeaFormat;
}

export interface ParsedIdea extends IdeaMeta {
  /** Markdown body (frontmatter removed). */
  body: string;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
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

/** Rough reading time from a Markdown body. Image syntax and ```viz chart specs are not counted as words. */
export function readingMinutes(body: string): number {
  const text = body.replace(/```viz[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/** Visible text of an HTML page (tags, style and script removed), for the reading-time estimate. */
export function htmlText(html: string): string {
  return html
    .replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
}

/**
 * Parses one report file. Throws a readable Error when a required field is missing or malformed.
 * `pageHtml` is the brochure page for `format: brochure` (used only for the reading-time estimate).
 */
export function parseIdea(path: string, raw: string, pageHtml?: string): ParsedIdea {
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
  const format = str('format') || 'markdown';
  if (!IDEA_FORMATS.includes(format as IdeaFormat)) {
    throw new Error(`frontmatter "format" must be one of: ${IDEA_FORMATS.join(', ')}`);
  }
  if (format === 'brochure' && pageHtml === undefined) {
    throw new Error(`format "brochure" needs content/ideas/pages/${slug}.html`);
  }
  const rawTags = data.tags;
  const tagList = Array.isArray(rawTags) ? rawTags : typeof rawTags === 'string' ? splitList(rawTags) : [];
  const minutes = format === 'brochure' ? readingMinutes(htmlText(pageHtml ?? '')) : readingMinutes(body);
  return { slug, title, date, summary, tags: dedupeTags(tagList), minutes, format: format as IdeaFormat, body };
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
export function sortIdeas<T extends Pick<IdeaMeta, 'date' | 'title'>>(ideas: readonly T[]): T[] {
  return [...ideas].sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : a.date < b.date ? 1 : -1));
}
