import { upsertMark } from '../quotes/quotes.js';
import type { ChartPoint, NewsItem } from './types.js';

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

export const USER_AGENT =
  'Mozilla/5.0 (compatible; SeekTrack/1.0; +https://github.com/karthikl6333/Seek-Track)';

/**
 * Reliable Cloudflare Workers detection.
 * nodejs_compat makes process.versions.node unreliable, so check CF-specific globals.
 */
export function isCloudflareWorkers(): boolean {
  // CF Workers have HTMLRewriter and caches, but no DOM window
  return (
    typeof (globalThis as any).HTMLRewriter !== 'undefined' &&
    typeof (globalThis as any).caches !== 'undefined' &&
    typeof (globalThis as any).window === 'undefined'
  );
}

async function fetchYahooQuoteFull(symbol: string): Promise<{
  price: number;
  dayPct: number | null;
  shortName: string | null;
  longName: string | null;
}> {
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=true`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${symbol}`);
  const data = (await res.json()) as {
    chart?: {
      result?: Array<{
        meta?: {
          regularMarketPrice?: number;
          fulldayPrice?: number;
          hasPrePostMarketData?: boolean;
          previousClose?: number;
          chartPreviousClose?: number;
          regularMarketChangePercent?: number;
          shortName?: string;
          longName?: string;
          currentTradingPeriod?: {
            pre?: { start?: number; end?: number };
            regular?: { start?: number; end?: number };
            post?: { start?: number; end?: number };
          };
          regularMarketTime?: number;
        };
      }>;
      error?: { description?: string } | null;
    };
  };
  const result = data.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) throw new Error(data.chart?.error?.description || `No quote for ${symbol}`);

  const now = Math.floor(Date.now() / 1000);
  const regularStart = meta.currentTradingPeriod?.regular?.start;
  const regularEnd = meta.currentTradingPeriod?.regular?.end;
  const isRegularHours =
    regularStart != null && regularEnd != null && now >= regularStart && now < regularEnd;

  let price: number | null = null;
  if (isRegularHours) {
    price = meta.regularMarketPrice ?? null;
  } else if (meta.hasPrePostMarketData && meta.fulldayPrice != null) {
    price = meta.fulldayPrice;
  }

  if (price === null || !Number.isFinite(price)) {
    price =
      meta.fulldayPrice ??
      meta.regularMarketPrice ??
      meta.previousClose ??
      meta.chartPreviousClose ??
      null;
  }
  if (price === null || !Number.isFinite(price)) throw new Error(`No price for ${symbol}`);

  let dayPct: number | null = null;
  const prevCloseRaw = meta.previousClose ?? meta.chartPreviousClose ?? null;
  const previousClose = prevCloseRaw !== null && Number.isFinite(prevCloseRaw) ? Number(prevCloseRaw) : null;
  
  if (price !== null && previousClose !== null && previousClose !== 0) {
    dayPct = ((price - previousClose) / previousClose) * 100;
  } else if (
    typeof meta.regularMarketChangePercent === 'number' &&
    Number.isFinite(meta.regularMarketChangePercent)
  ) {
    dayPct = meta.regularMarketChangePercent;
  }

  return {
    price: Number(price),
    dayPct: dayPct !== null && Number.isFinite(dayPct) ? dayPct : null,
    shortName: meta.shortName ?? null,
    longName: meta.longName ?? null,
  };
}

// upsertMark imported above and re-exported for external consumers
export { upsertMark };

export async function fetchChartSeries(
  symbols: string[],
  range = '3mo',
): Promise<{ dates: string[]; series: Record<string, Array<number | null>> }> {
  const series: Record<string, Array<number | null>> = {};
  let dates: string[] = [];

  for (const symbol of symbols) {
    try {
      const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(range)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (!res.ok) {
        series[symbol] = [];
        continue;
      }
      const data = (await res.json()) as {
        chart?: {
          result?: Array<{
            timestamp?: number[];
            indicators?: { quote?: Array<{ close?: Array<number | null> }> };
          }>;
        };
      };
      const result = data.chart?.result?.[0];
      const ts = result?.timestamp ?? [];
      const closes = result?.indicators?.quote?.[0]?.close ?? [];
      const localDates = ts.map((t) => new Date(t * 1000).toISOString().slice(0, 10));
      if (!dates.length || localDates.length > dates.length) {
        dates = localDates;
      }
      const byDate = new Map<string, number | null>();
      for (let i = 0; i < localDates.length; i++) {
        const c = closes[i];
        byDate.set(localDates[i], c != null && Number.isFinite(c) ? Number(c) : null);
      }
      series[symbol] = dates.map((d) => byDate.get(d) ?? null);
      await new Promise((r) => setTimeout(r, 60));
    } catch {
      series[symbol] = [];
    }
  }

  return { dates, series };
}

export function buildChartPoints(
  dates: string[],
  series: Record<string, Array<number | null>>,
): ChartPoint[] {
  return dates.map((date, i) => {
    const point: ChartPoint = { date };
    for (const [sym, values] of Object.entries(series)) {
      point[sym] = values[i] ?? null;
    }
    return point;
  });
}

export async function fetchNewsForSymbol(
  symbol: string,
  companyName: string,
): Promise<{ items: NewsItem[]; error?: string }> {
  const queryText = encodeURIComponent(`${symbol} OR "${companyName}" stock`);
  const url = `https://news.google.com/rss/search?q=${queryText}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      // Add timeout to prevent hanging
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      // Return empty items with error message instead of throwing
      return { items: [], error: `News API returned ${res.status}` };
    }
    const xml = await res.text();
    const items: NewsItem[] = [];
    const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
    for (const block of itemBlocks.slice(0, 10)) {
      const title = decodeXml(
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ||
          block.match(/<title>(.*?)<\/title>/)?.[1] ||
          '').trim(),
      );
      const link = (
        block.match(/<link>(.*?)<\/link>/)?.[1] ||
        block.match(/<link[^>]*href="([^"]+)"/)?.[1] ||
        ''
      ).trim();
      const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '').trim();
      const source = decodeXml(
        (block.match(/<source[^>]*>(.*?)<\/source>/)?.[1] || '').trim(),
      );
      // Google titles often end with " - Source"
      let cleanTitle = title;
      let inferredSource = source;
      const dash = title.lastIndexOf(' - ');
      if (dash > 0) {
        const tail = title.slice(dash + 3).trim();
        if (!inferredSource) inferredSource = tail;
        if (!source || tail === source || tail.length <= 40) {
          cleanTitle = title.slice(0, dash).trim();
        }
      }
      if (!cleanTitle || !link) continue;
      let publishedAt: string | null = null;
      if (pubDate) {
        const d = new Date(pubDate);
        if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
      }
      items.push({
        title: cleanTitle,
        source: inferredSource || 'News',
        publishedAt,
        url: link,
      });
    }
    return { items };
  } catch (e) {
    // Return friendly error message for common cases
    const errMsg = String(e);
    if (errMsg.includes('aborted') || errMsg.includes('timeout')) {
      return { items: [], error: 'News API timeout' };
    }
    return { items: [], error: 'News unavailable' };
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
