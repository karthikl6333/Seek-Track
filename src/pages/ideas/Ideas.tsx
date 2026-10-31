import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './ideas.css';
import { FilterChips } from '../../components/FilterChips';
import { IDEAS, IDEA_ERRORS } from '../../content/ideas';
import { filterIdeas, formatIdeaDate, ideaHash, ideaSlugFromHash, readingMinutes, tagCounts } from '../../lib/ideas';
import { IdeaReport } from './IdeaReport';

/** Ideas tab: saved research reports. List with tag chips and search; `#ideas/<slug>` opens one. */
export function Ideas() {
  const [slug, setSlug] = useState<string | null>(() => ideaSlugFromHash(window.location.hash));
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState<ReadonlySet<string>>(new Set());
  // True when the open report was reached from the list inside this session, so Back can use history.
  const fromList = useRef(false);

  useEffect(() => {
    const onHash = () => setSlug(ideaSlugFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const open = useCallback((next: string) => {
    fromList.current = true;
    window.location.hash = ideaHash(next);
  }, []);

  const back = useCallback(() => {
    if (fromList.current) {
      fromList.current = false;
      window.history.back();
    } else {
      window.location.hash = ideaHash(null);
    }
  }, []);

  const chips = useMemo(() => tagCounts(IDEAS), []);
  const visible = useMemo(() => filterIdeas(IDEAS, tags, query), [tags, query]);

  if (slug) {
    const idea = IDEAS.find((i) => i.slug === slug);
    return <IdeaReport idea={idea} onBack={back} />;
  }

  const toggleTag = (tag: string) =>
    setTags((cur) => {
      const next = new Set(cur);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  return (
    <section className="ideas" aria-label="Ideas">
      {IDEA_ERRORS.length > 0 && (
        <div className="caveat" role="alert">
          {IDEA_ERRORS.length} report file(s) could not be read and are hidden:{' '}
          {IDEA_ERRORS.map((e) => `${e.path}: ${e.message}`).join('; ')}
        </div>
      )}
      <div className="ideas-toolbar">
        <div className="field ideas-search">
          <label htmlFor="ideas-search">Search reports</label>
          <input
            id="ideas-search"
            type="search"
            placeholder="Title, summary or tag"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>
        <p className="muted ideas-count">
          {visible.length === IDEAS.length ? `${IDEAS.length} reports` : `${visible.length} of ${IDEAS.length} reports`}
        </p>
      </div>
      {chips.length > 0 && (
        <FilterChips
          ariaLabel="Filter reports by tag"
          options={chips.map((c) => ({ key: c.tag, label: c.tag, count: c.count }))}
          active={tags}
          totalCount={IDEAS.length}
          onToggle={toggleTag}
          onClear={() => setTags(new Set())}
        />
      )}
      {visible.length === 0 ? (
        <div className="empty-state muted">
          {IDEAS.length === 0 ? 'No reports yet. See docs/ADDING_IDEAS.md.' : 'No reports match this search and tag filter.'}
        </div>
      ) : (
        <ul className="ideas-list">
          {visible.map((i) => (
            <li key={i.slug}>
              <a
                className="card idea-card"
                href={ideaHash(i.slug)}
                onClick={(e) => {
                  // plain click: keep Ideas state and use the same navigation as the rest of the page
                  if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                    e.preventDefault();
                    open(i.slug);
                  }
                }}
              >
                <span className="idea-card-title">{i.title}</span>
                <span className="idea-card-meta muted">
                  {formatIdeaDate(i.date)} · {readingMinutes(i.body)} min read
                </span>
                <span className="idea-card-summary">{i.summary}</span>
                {i.tags.length > 0 && (
                  <span className="idea-tags">
                    {i.tags.map((t) => (
                      <span key={t} className="idea-tag">
                        {t}
                      </span>
                    ))}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
