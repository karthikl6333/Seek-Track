import { useEffect, useMemo } from 'react';
import { resolveIdeaAsset } from '../../content/ideas';
import { formatIdeaDate, readingMinutes, type Idea } from '../../lib/ideas';
import { createSanitizer, renderIdeaMarkdown } from './markdown';

let sanitizer: ((dirty: string) => string) | null = null;
function sanitize(dirty: string): string {
  sanitizer ??= createSanitizer(window);
  return sanitizer(dirty);
}

/** One report, rendered from Markdown (sanitized) with a Back button and a contents list. */
export function IdeaReport({ idea, onBack }: { idea: Idea | undefined; onBack: () => void }) {
  const slug = idea?.slug;

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [slug]);

  const rendered = useMemo(() => {
    if (!idea) return null;
    const { html, toc } = renderIdeaMarkdown(idea.body, resolveIdeaAsset);
    return { html: sanitize(html), toc };
  }, [idea]);

  return (
    <div className="idea-report">
      <div className="idea-report-bar">
        <button type="button" className="btn small" onClick={onBack}>
          ← All reports
        </button>
      </div>
      {!idea || !rendered ? (
        <div className="empty-state muted">This report does not exist (it may have been renamed or removed).</div>
      ) : (
        <article className="card idea-article">
          <header className="idea-header">
            <h1>{idea.title}</h1>
            <p className="idea-card-meta muted">
              {formatIdeaDate(idea.date)} · {readingMinutes(idea.body)} min read
              {idea.source && (
                <>
                  {' · '}
                  <a href={idea.source} target="_blank" rel="noopener noreferrer">
                    Original source
                  </a>
                </>
              )}
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
