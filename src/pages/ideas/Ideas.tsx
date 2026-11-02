import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './ideas.css';
import { FilterChips } from '../../components/FilterChips';
import { loadIdeaList, updateIdeaMetadata } from '../../api/ideas';
import { filterIdeas, formatIdeaDate, ideaHash, ideaSlugFromHash, sortIdeas, tagCounts, type IdeaListResponse } from '../../lib/ideas';
import { IdeaReport } from './IdeaReport';

/** Ideas tab: saved research reports. List with tag chips and search; `#ideas/<slug>` opens one. */
export function Ideas() {
  const [slug, setSlug] = useState<string | null>(() => ideaSlugFromHash(window.location.hash));
  const [list, setList] = useState<IdeaListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState<ReadonlySet<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
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

  const ideas = useMemo(() => sortIdeas(list?.ideas ?? []), [list]);
  const chips = useMemo(() => tagCounts(ideas), [ideas]);
  const visible = useMemo(() => filterIdeas(ideas, tags, query, statusFilter, !showArchived), [ideas, tags, query, statusFilter, showArchived]);

  if (slug) return <IdeaReport slug={slug} onBack={back} />;

  const toggleTag = (tag: string) =>
    setTags((cur) => {
      const next = new Set(cur);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  const toggleStatus = (status: string) =>
    setStatusFilter((cur) => {
      const next = new Set(cur);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });

  const togglePin = async (slug: string, currentPinned: boolean) => {
    try {
      await updateIdeaMetadata(slug, { pinned: !currentPinned });
      setAttempt((n) => n + 1); // Reload the list
    } catch (e) {
      console.error('Failed to toggle pin:', e);
    }
  };

  const changeStatus = async (slug: string, status: 'new' | 'reading' | 'done' | 'archived') => {
    try {
      await updateIdeaMetadata(slug, { status });
      setAttempt((n) => n + 1); // Reload the list
    } catch (e) {
      console.error('Failed to update status:', e);
    }
  };

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
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <button
            type="button"
            className={`btn small${showArchived ? ' primary' : ''}`}
            onClick={() => setShowArchived(!showArchived)}
            title={showArchived ? 'Hide archived reports' : 'Show archived reports'}
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
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
      <div style={{ marginTop: '8px' }}>
        <FilterChips
          ariaLabel="Filter reports by status"
          options={[
            { key: 'new', label: 'New', count: ideas.filter((i) => (i.status ?? 'new') === 'new').length },
            { key: 'reading', label: 'Reading', count: ideas.filter((i) => i.status === 'reading').length },
            { key: 'done', label: 'Done', count: ideas.filter((i) => i.status === 'done').length },
          ]}
          active={statusFilter}
          totalCount={ideas.length}
          onToggle={toggleStatus}
          onClear={() => setStatusFilter(new Set())}
        />
      </div>
      {!list ? (
        error ? null : <p className="muted">Loading reports…</p>
      ) : visible.length === 0 ? (
        <div className="empty-state muted">
          {ideas.length === 0 ? 'No reports yet. See docs/ADDING_IDEAS.md.' : 'No reports match this search and tag filter.'}
        </div>
      ) : (
        <ul className="ideas-list">
          {visible.map((i) => {
            const status = i.status ?? 'new';
            const pinned = i.pinned ?? false;
            return (
              <li key={i.slug}>
                <div className="card idea-card-wrapper">
                  <div className="idea-card-controls">
                    <button
                      type="button"
                      className={`btn small ghost idea-pin-btn${pinned ? ' pinned' : ''}`}
                      onClick={() => togglePin(i.slug, pinned)}
                      title={pinned ? 'Unpin report' : 'Pin report to top'}
                      aria-label={pinned ? 'Unpin report' : 'Pin report'}
                    >
                      {pinned ? '📌' : '📍'}
                    </button>
                    <select
                      className="idea-status-select"
                      value={status}
                      onChange={(e) => changeStatus(i.slug, e.target.value as any)}
                      onClick={(e) => e.stopPropagation()}
                      title="Change status"
                    >
                      <option value="new">New</option>
                      <option value="reading">Reading</option>
                      <option value="done">Done</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  <a
                    className="idea-card-link"
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
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
