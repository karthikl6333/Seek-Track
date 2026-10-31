import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../api/http';
import { keepLastNews, NEWS_REFRESH_MS, shouldAutoRefreshNews, type NewsItem, type TopNewsResponse } from '../lib/news';

/**
 * Top-news headlines. One fetch on mount (even on a weekend), then every 15 min on trading days
 * only, only while the tab is visible. Fails quietly: keeps the last headlines; never shows an error.
 */
export function useTopNews(): NewsItem[] {
  const [items, setItems] = useState<NewsItem[]>([]);
  const lastFetchRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      lastFetchRef.current = Date.now();
      try {
        const data = await apiGet<TopNewsResponse>('/api/news/top');
        if (!cancelled) setItems((prev) => keepLastNews(prev, data));
      } catch {
        // quiet: keep whatever we had
      }
    };
    void load();

    const tick = () => {
      if (shouldAutoRefreshNews({ now: new Date(), hidden: document.hidden, lastFetchMs: lastFetchRef.current })) {
        void load();
      }
    };
    const timer = window.setInterval(tick, NEWS_REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  return items;
}
