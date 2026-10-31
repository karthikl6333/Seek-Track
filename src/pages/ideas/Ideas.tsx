import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './ideas.css';
import { FilterChips } from '../../components/FilterChips';
import { loadIdeaList } from '../../api/ideas';
import { filterIdeas, formatIdeaDate, ideaHash, ideaSlugFromHash, tagCounts, type IdeaListResponse } from '../../lib/ideas';
import { IdeaReport } from './IdeaReport';

/** Ideas tab: saved research reports. List with tag chips and search; `#ideas/<slug>` opens one. */
export function Ideas() {
  const [slug, setSlug] = useState<string | null>(() => ideaSlugFromHash(window.location.hash));
  const [list, setList] = useState<IdeaListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState<ReadonlySet<string>>(new Set());
  // True when the open report was reached from the list inside this session, so Back can use history.
  const fromList = useRef(false);

  useEffect(() => {
    const onHash = () => setSlug(ideaSlugFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // The reports are served by the authed API (never bundled), so the list is fetched on mount.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadIdeaList()
      .then((r) => {
        if (!cancelled) setList(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

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

  const ideas = list?.ideas ?? [];
  const chips = useMemo(() => tagCounts(ideas), [list]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = useMemo(() => filterIdeas(ideas, tags, query), [list, tags, query]); // eslint-disable-line react-hooks/exhaustive-deps

  if (slug) return <IdeaReport slug={slug} onBack={back} />;

  const toggleTag = (tag: string) =>
    setTags((cur) => {
      const next = new Set(cur);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  return (
    <section className="ideas" aria-label="Ideas">
      {error && (
        <div className="caveat" role="alert">
          Could not load the reports: {error}{' '}
          <button type="button" className="btn small" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {list && list.errors.length > 0 && (
        <div className="caveat" role="alert">
          {list.errors.length} report file(s) could not be read and are hidden:{' '}
          {list.errors.map((e) => `${e.file}: ${e.message}`).join('; ')}
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
          {!list
            ? error
              ? ''
              : 'Loading…'
            : visible.length === ideas.length
              ? `${ideas.length} reports`
              : `${visible.length} of ${ideas.length} reports`}
        </p>
      </div>
      {chips.length > 0 && (
        <FilterChips
          ariaLabel="Filter reports by tag"
          options={chips.map((c) => ({ key: c.tag, label: c.tag, count: c.count }))}
          active={tags}
          totalCount={ideas.length}
          onToggle={toggleTag}
          onClear={() => setTags(new Set())}
        />
      )}
      {!list ? (
        error ? null : <p className="muted">Loading reports…</p>
      ) : visible.length === 0 ? (
        <div className="empty-state muted">
          {ideas.length === 0 ? 'No reports yet. See docs/ADDING_IDEAS.md.' : 'No reports match this search and tag filter.'}
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
                  {formatIdeaDate(i.date)} · {i.minutes} min read
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
