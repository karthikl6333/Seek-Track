import { Marked, type Tokens } from 'marked';
import createDOMPurify from 'dompurify';
import { renderViz } from './viz';

/**
 * Markdown -> HTML for Ideas reports. Two separate steps so the first stays pure and testable:
 *  1. renderIdeaMarkdown(): marked (GFM) with a few renderer tweaks (callouts, images, headings, tables).
 *  2. createSanitizer(window): DOMPurify. The result of step 1 must ALWAYS go through it before
 *     being put into the page (the page does, see IdeaReport.tsx).
 */

export interface TocItem {
  id: string;
  text: string;
}

export interface RenderedIdea {
  html: string;
  /** Level-2 headings, for the in-report contents list. */
  toc: TocItem[];
}

const ALERT_RE = /^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>\s*)?/i;

const ALERT_TITLES: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Lowercase, dash-separated id; always prefixed so it can never clash with an app element id. */
export function headingId(text: string, used: Map<string, number>): string {
  const base =
    'idea-' +
    (text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section');
  const n = used.get(base) ?? 0;
  used.set(base, n + 1);
  return n === 0 ? base : `${base}-${n + 1}`;
}

export function renderIdeaMarkdown(body: string, resolveAsset: (ref: string) => string | null): RenderedIdea {
  const toc: TocItem[] = [];
  const used = new Map<string, number>();
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      heading({ tokens, depth, text }: Tokens.Heading) {
        const id = headingId(text, used);
        if (depth === 2) toc.push({ id, text: text.replace(/[*_`]/g, '') });
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      // ```viz blocks (JSON) become inline-SVG charts/flows; a bad spec shows its error instead of breaking the report.
      code({ text, lang }: Tokens.Code) {
        if ((lang ?? '').trim() !== 'viz') return false;
        try {
          return renderViz(text) + '\n';
        } catch (e) {
          return `<pre class="idea-viz-error"><code>Chart error: ${escapeHtml(e instanceof Error ? e.message : String(e))}</code></pre>\n`;
        }
      },
      image({ href, title, text }: Tokens.Image) {
        const external = /^https?:\/\//i.test(href);
        const src = external ? href : resolveAsset(href);
        if (!src) return escapeHtml(text);
        const t = title ? ` title="${escapeHtml(title)}"` : '';
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text)}"${t} loading="lazy" decoding="async">`;
      },
      blockquote({ tokens }: Tokens.Blockquote) {
        const inner = this.parser.parse(tokens);
        const m = ALERT_RE.exec(inner);
        if (!m) return `<blockquote class="idea-callout">\n${inner}</blockquote>\n`;
        const kind = m[1].toLowerCase();
        const rest = inner.slice(m[0].length);
        // "<p>[!NOTE]</p>" alone leaves an empty paragraph behind
        const content = rest.startsWith('</p>') ? rest.slice(4) : '<p>' + rest;
        return (
          `<blockquote class="idea-callout idea-callout-${kind}">` +
          `<p class="idea-callout-title">${ALERT_TITLES[kind]}</p>\n${content}</blockquote>\n`
        );
      },
    },
  });
  const raw = marked.parse(body, { async: false }) as string;
  const html = raw.replace(/<table>/g, '<div class="idea-table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  return { html, toc };
}

type Purifier = ReturnType<typeof createDOMPurify>;

/**
 * DOMPurify bound to `win`. Default allow-list (no script, style, iframe, event handlers, javascript:
 * URLs), plus: every link opens in a new tab with rel=noopener noreferrer, images are lazy and cannot
 * overflow. The svg profile is on for the inline charts from viz.ts (still no style, script or foreignObject). Task-list checkboxes are kept but forced read-only.
 */
export function createSanitizer(win: Window & typeof globalThis): (dirty: string) => string {
  const purify: Purifier = createDOMPurify(win);
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
    if (node.tagName === 'IMG') {
      node.setAttribute('loading', 'lazy');
      node.setAttribute('decoding', 'async');
    }
    if (node.tagName === 'INPUT') {
      node.setAttribute('disabled', '');
      node.setAttribute('type', 'checkbox');
    }
  });
  return (dirty: string) =>
    purify.sanitize(dirty, {
      USE_PROFILES: { html: true, svg: true },
      FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option'],
      FORBID_ATTR: ['style'],
      ADD_ATTR: ['target'],
    });
}
