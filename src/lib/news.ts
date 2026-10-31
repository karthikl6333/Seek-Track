import { autoRefreshAllowedAt } from './marketHours';

/** Plain news headline for the sidebar block (no ratings / signals / advice - ever). */
export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
}

export interface TopNewsResponse {
  items: NewsItem[];
  fetchedAt: string | null;
  stale: boolean;
}

/** Headlines shown in the sidebar (the server returns the top 5). */
export const NEWS_COUNT = 5;
export const NEWS_REFRESH_MS = 15 * 60_000;

/** "just now" / "12m ago" / "3h ago" / "2d ago"; empty string for an unparseable time. */
export function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const min = Math.floor((nowMs - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Whether the periodic loop may refetch now: never while the tab is hidden, and never inside the
 * weekend / NYSE-holiday window (same rule as the quote auto-refresh). The first load on mount is
 * separate and always allowed, so the block still shows the latest headlines on a weekend.
 */
export function shouldAutoRefreshNews(opts: { now: Date; hidden: boolean; lastFetchMs: number | null }): boolean {
  if (opts.hidden) return false;
  if (!autoRefreshAllowedAt(opts.now)) return false;
  return opts.lastFetchMs === null || opts.now.getTime() - opts.lastFetchMs >= NEWS_REFRESH_MS - 1000;
}

/** Keep the last headlines when a refresh fails or comes back empty. */
export function keepLastNews(prev: NewsItem[], next: TopNewsResponse | null | undefined): NewsItem[] {
  const items = next?.items;
  if (!Array.isArray(items) || items.length === 0) return prev;
  return items
    .filter((i) => i && typeof i.title === 'string' && /^https?:\/\//i.test(i.url))
    .slice(0, NEWS_COUNT);
}
