import { useEffect, useMemo, useState } from 'react';
import { loadIdea, resolveIdeaImage, resolveIdeaPage } from '../../api/ideas';
import { BROCHURE_SANDBOX, formatIdeaDate, type Idea } from '../../lib/ideas';
import { createSanitizer, renderIdeaMarkdown } from './markdown';

let sanitizer: ((dirty: string) => string) | null = null;
function sanitize(dirty: string): string {
  sanitizer ??= createSanitizer(window);
  return sanitizer(dirty);
}

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'missing' } | { state: 'ready'; idea: Idea };

/** One report: fetched from the authed API, rendered from Markdown (sanitized), with a Back button and contents. */
export function IdeaReport({ slug, onBack }: { slug: string; onBack: () => void }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: 'loading' });
    loadIdea(slug)
      .then((idea) => {
        if (!cancelled) setLoad({ state: 'ready', idea });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setLoad(/^404\b/.test(message) ? { state: 'missing' } : { state: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [slug, attempt]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [slug]);

  const idea = load.state === 'ready' ? load.idea : null;
  const rendered = useMemo(() => {
    if (!idea || idea.format === 'brochure') return null;
    const { html, toc } = renderIdeaMarkdown(idea.body, resolveIdeaImage);
    return { html: sanitize(html), toc };
  }, [idea]);

  const pageUrl = idea?.format === 'brochure' ? resolveIdeaPage(idea.slug) : null;

  return (
    <div className={`idea-report${pageUrl ? ' idea-report-brochure' : ''}`}>
      <div className="idea-report-bar">
        <button type="button" className="btn small" onClick={onBack}>
          ← All reports
        </button>
        {pageUrl && (
          <a className="btn small" href={pageUrl} target="_blank" rel="noopener noreferrer">
            Open full screen ↗
          </a>
        )}
      </div>
      {load.state === 'loading' ? (
        <p className="muted">Loading report…</p>
      ) : load.state === 'error' ? (
        <div className="caveat" role="alert">
          Could not load this report: {load.message}{' '}
          <button type="button" className="btn small" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      ) : pageUrl && idea ? (
        // The brochure is its own full web page: shown full-width in a sandboxed iframe (scripts + popups only,
        // opaque origin). It fills the viewport and scrolls inside; "Open full screen" opens the same authed URL.
        <iframe className="idea-brochure-frame" title={idea.title} src={pageUrl} sandbox={BROCHURE_SANDBOX} referrerPolicy="no-referrer" />
      ) : load.state === 'missing' || !idea || !rendered ? (
        <div className="empty-state muted">This report does not exist (it may have been renamed or removed).</div>
      ) : (
        <article className="card idea-article">
          <header className="idea-header">
            <h1>{idea.title}</h1>
            <p className="idea-card-meta muted">
              {formatIdeaDate(idea.date)} · {idea.minutes} min read
            </p>
            {idea.tags.length > 0 && (
              <span className="idea-tags">
                {idea.tags.map((t) => (
                  <span key={t} className="idea-tag">
                    {t}
                  </span>
                ))}
              </span>
            )}
            <p className="idea-summary">{idea.summary}</p>
          </header>
          {rendered.toc.length >= 3 && (
            <nav className="idea-toc" aria-label="Contents">
              <h3>Contents</h3>
              <ol>
                {rendered.toc.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="idea-toc-link"
                      onClick={() => document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    >
                      {t.text}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <div className="idea-body" dangerouslySetInnerHTML={{ __html: rendered.html }} />
        </article>
      )}
    </div>
  );
}
