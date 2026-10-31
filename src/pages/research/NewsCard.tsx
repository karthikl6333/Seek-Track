import { fmtTime } from './format';
import type { ResearchDetail } from './types';

export function NewsCard({ symbol, detail }: { symbol: string; detail: ResearchDetail | null }) {
  const selected = symbol;
  return (
    <div className="card">
      <h3>News · <span className="mono">{selected}</span></h3>
      {detail?.newsError && !detail.news.length ? (
        <p className="muted empty-state">No headlines available ({detail.newsError}).</p>
      ) : !detail?.news?.length ? (
        <p className="muted empty-state">No headlines found for <span className="mono">{selected}</span>.</p>
      ) : (
        <ul className="news-list news-list-side">
          {detail.news.map((n) => (
            <li key={n.url + n.title}>
              <a href={n.url} target="_blank" rel="noopener noreferrer">
                {n.title}
              </a>
              <div className="muted" style={{ fontSize: 12 }}>
                {n.source}
                {n.publishedAt ? ` · ${fmtTime(n.publishedAt)}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
