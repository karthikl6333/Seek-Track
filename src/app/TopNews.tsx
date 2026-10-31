import { relativeTime, type NewsItem } from '../lib/news';

/** Compact "Top news" block: 3 plain headlines (link, source, age). Hidden when there are none. */
export function TopNews({ items, nowMs }: { items: NewsItem[]; nowMs: number }) {
  if (items.length === 0) return null;
  return (
    <section className="top-news" aria-label="Top news">
      <h2 className="top-news-title">Top news</h2>
      <ul className="top-news-list">
        {items.slice(0, 3).map((n) => (
          <li key={n.url}>
            <a href={n.url} target="_blank" rel="noopener noreferrer" className="top-news-link" title={n.title}>
              {n.title}
            </a>
            <span className="top-news-meta">
              {n.source}
              {relativeTime(n.publishedAt, nowMs) ? ` · ${relativeTime(n.publishedAt, nowMs)}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
