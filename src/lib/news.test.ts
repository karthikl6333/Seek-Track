import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TopNews } from '../app/TopNews';
import { keepLastNews, NEWS_REFRESH_MS, relativeTime, shouldAutoRefreshNews, type NewsItem } from './news';

const NOW = Date.parse('2026-10-28T15:00:00Z'); // Wednesday 11:00 ET
const item = (n: number, o: Partial<NewsItem> = {}): NewsItem => ({
  title: `Headline ${n}`, url: `https://news.test/${n}`, source: 'CNBC', publishedAt: '2026-10-28T14:00:00Z', ...o,
});

describe('relativeTime', () => {
  it('formats minutes, hours, days', () => {
    expect(relativeTime('2026-10-28T14:59:40Z', NOW)).toBe('just now');
    expect(relativeTime('2026-10-28T14:48:00Z', NOW)).toBe('12m ago');
    expect(relativeTime('2026-10-28T12:00:00Z', NOW)).toBe('3h ago');
    expect(relativeTime('2026-10-25T15:00:00Z', NOW)).toBe('3d ago');
    expect(relativeTime('garbage', NOW)).toBe('');
  });
});

describe('shouldAutoRefreshNews (weekdays only, 15 min)', () => {
  const base = { hidden: false, lastFetchMs: NOW - NEWS_REFRESH_MS };
  it('refreshes on a trading day after 15 min', () => {
    expect(shouldAutoRefreshNews({ now: new Date(NOW), ...base })).toBe(true);
    expect(shouldAutoRefreshNews({ now: new Date(NOW), hidden: false, lastFetchMs: null })).toBe(true);
  });
  it('not before 15 min, and never while the tab is hidden', () => {
    expect(shouldAutoRefreshNews({ now: new Date(NOW), hidden: false, lastFetchMs: NOW - 5 * 60_000 })).toBe(false);
    expect(shouldAutoRefreshNews({ now: new Date(NOW), ...base, hidden: true })).toBe(false);
  });
  it('never on the weekend or an NYSE holiday', () => {
    const sat = new Date('2026-10-31T10:00:00Z');
    expect(shouldAutoRefreshNews({ now: sat, hidden: false, lastFetchMs: sat.getTime() - 3600_000 })).toBe(false);
    const thanksgiving = new Date('2026-11-26T15:00:00Z');
    expect(shouldAutoRefreshNews({ now: thanksgiving, hidden: false, lastFetchMs: null })).toBe(false);
  });
});

describe('keepLastNews', () => {
  it('keeps the last headlines on failure / empty response', () => {
    const prev = [item(1), item(2)];
    expect(keepLastNews(prev, null)).toBe(prev);
    expect(keepLastNews(prev, { items: [], fetchedAt: null, stale: true })).toBe(prev);
  });
  it('takes new headlines (max 3) and drops non-http links', () => {
    const next = { items: [item(1), item(2, { url: 'javascript:alert(1)' }), item(3), item(4), item(5)], fetchedAt: 'x', stale: false };
    expect(keepLastNews([], next).map((i) => i.title)).toEqual(['Headline 1', 'Headline 3', 'Headline 4']);
  });
});

describe('TopNews block', () => {
  it('renders nothing when there are no headlines', () => {
    expect(renderToStaticMarkup(createElement(TopNews, { items: [], nowMs: NOW }))).toBe('');
  });
  it('renders 3 links that open in a new tab with rel=noopener, plus source and age; plain news only', () => {
    const html = renderToStaticMarkup(createElement(TopNews, { items: [item(1), item(2), item(3), item(4)], nowMs: NOW }));
    expect((html.match(/<a /g) ?? []).length).toBe(3);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('CNBC · 1h ago');
    expect(html).not.toMatch(/buy|sell|signal|sentiment|recommend|bullish|bearish/i);
  });
});
