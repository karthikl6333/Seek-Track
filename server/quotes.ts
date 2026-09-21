import type { Context } from 'hono';
import { query } from './db.js';

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const USER_AGENT =
  'Mozilla/5.0 (compatible; SeekTrack/1.0; +https://github.com/karthikl6333/Seek-Track)';

export interface MarkInfo {
  symbol: string;
  price: number;
  updatedAt: string;
  source: string;
  dayPct: number | null;
}

let lastRefreshAt: string | null = null;
let lastRefreshError: string | null = null;
let refreshInFlight: Promise<RefreshResult> | null = null;

export interface RefreshResult {
  ok: boolean;
  updated: string[];
  failed: string[];
  error?: string;
  refreshedAt: string;
}

export interface QuoteWithPct {
  price: number;
  dayPct: number | null;
  source: string;
}

/**
 * Unified quote fetch: Yahoo only.
 * Returns price + dayPct when available.
 */
export async function fetchQuotesBatch(
  symbols: string[],
): Promise<Map<string, QuoteWithPct | null>> {
  if (symbols.length === 0) return new Map();
  return fetchYahooQuotesBatchFull(symbols);
}

async function fetchYahooQuotesBatchFull(
  symbols: string[],
): Promise<Map<string, QuoteWithPct | null>> {
  const result = new Map<string, QuoteWithPct | null>();
  
  for (const symbol of symbols) {
    try {
      const quote = await fetchYahooQuoteWithPct(symbol);
      result.set(symbol, quote);
      // Rate limit: 80ms between Yahoo requests
      await new Promise((r) => setTimeout(r, 80));
    } catch {
      result.set(symbol, null);
    }
  }
  
  return result;
}

async function fetchYahooQuoteWithPct(symbol: string): Promise<QuoteWithPct> {
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=true`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`Yahoo HTTP ${res.status} for ${symbol}`);
  }
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
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) {
    throw new Error(data.chart?.error?.description || `No quote data for ${symbol}`);
  }

  let price: number | null = null;

  const now = Math.floor(Date.now() / 1000);
  const regularStart = meta.currentTradingPeriod?.regular?.start;
  const regularEnd = meta.currentTradingPeriod?.regular?.end;
  const isRegularHours =
    regularStart != null && regularEnd != null && now >= regularStart && now < regularEnd;

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

  if (price === null || !Number.isFinite(price)) {
    throw new Error(`No price for ${symbol}`);
  }

  // Calculate day % vs previous close
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
    source: 'yahoo',
  };
}

export interface YahooChartQuote {
  symbol: string;
  last: number | null;
  pctChange: number | null;
  valChange: number | null;
  previousClose: number | null;
  sessionOpen: number | null;
  volume: number | null;
  bid: number | null;
  ask: number | null;
  marketCap: number | null;
  week52High: number | null;
  week52Low: number | null;
}

/** Richer Yahoo chart v8 quote for watchlist enrichment (auth-free). */
export async function fetchYahooChartQuote(symbol: string): Promise<YahooChartQuote> {
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=true`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`Yahoo HTTP ${res.status} for ${symbol}`);
  }
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
          regularMarketVolume?: number;
          bid?: number;
          ask?: number;
          marketCap?: number;
          fiftyTwoWeekHigh?: number;
          fiftyTwoWeekLow?: number;
          symbol?: string;
          regularMarketTime?: number;
          currentTradingPeriod?: {
            pre?: {
              start?: number;
              end?: number;
            };
            regular?: {
              start?: number;
              end?: number;
            };
            post?: {
              start?: number;
              end?: number;
            };
          };
        };
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
      error?: { description?: string } | null;
    };
  };
  const result = data.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) {
    throw new Error(data.chart?.error?.description || `No quote data for ${symbol}`);
  }

  let lastRaw: number | null = null;

  const now = Math.floor(Date.now() / 1000);
  const regularStart = meta.currentTradingPeriod?.regular?.start;
  const regularEnd = meta.currentTradingPeriod?.regular?.end;
  const isRegularHours =
    regularStart != null && regularEnd != null && now >= regularStart && now < regularEnd;

  if (isRegularHours) {
    lastRaw = meta.regularMarketPrice ?? null;
  } else if (meta.hasPrePostMarketData && meta.fulldayPrice != null) {
    lastRaw = meta.fulldayPrice;
  }

  if (lastRaw === null || !Number.isFinite(lastRaw)) {
    lastRaw =
      meta.fulldayPrice ??
      meta.regularMarketPrice ??
      meta.previousClose ??
      meta.chartPreviousClose ??
      null;
  }

  const last = lastRaw !== null && Number.isFinite(lastRaw) ? Number(lastRaw) : null;
  const prevCloseRaw = meta.previousClose ?? meta.chartPreviousClose ?? null;
  const previousClose =
    prevCloseRaw !== null && Number.isFinite(prevCloseRaw) ? Number(prevCloseRaw) : null;

  let sessionOpen: number | null = null;
  const timestamps = result?.timestamp ?? [];
  const opens = result?.indicators?.quote?.[0]?.open ?? [];
  const sessionStart = meta.currentTradingPeriod?.regular?.start;

  if (sessionStart && timestamps.length > 0) {
    const todayBarIndex = timestamps.findIndex((ts) => ts === sessionStart);
    if (todayBarIndex >= 0 && todayBarIndex < opens.length) {
      const openRaw = opens[todayBarIndex];
      if (openRaw !== null && Number.isFinite(openRaw)) {
        sessionOpen = Number(openRaw);
      }
    }
  }

  let pctChange: number | null = null;
  let valChange: number | null = null;

  if (last !== null && sessionOpen !== null) {
    valChange = last - sessionOpen;
    if (sessionOpen !== 0) {
      pctChange = (valChange / sessionOpen) * 100;
    }
  } else if (last !== null && previousClose !== null) {
    valChange = last - previousClose;
    if (previousClose !== 0) {
      pctChange = (valChange / previousClose) * 100;
    }
  } else if (
    typeof meta.regularMarketChangePercent === 'number' &&
    Number.isFinite(meta.regularMarketChangePercent)
  ) {
    pctChange = Number(meta.regularMarketChangePercent);
  }

  let volume: number | null =
    typeof meta.regularMarketVolume === 'number' && Number.isFinite(meta.regularMarketVolume)
      ? Number(meta.regularMarketVolume)
      : null;
  if (volume === null) {
    const vols = result?.indicators?.quote?.[0]?.volume ?? [];
    const lastVol = [...vols].reverse().find((v) => v != null && Number.isFinite(v));
    if (lastVol != null) volume = Number(lastVol);
  }

  const bid =
    typeof meta.bid === 'number' && Number.isFinite(meta.bid) ? Number(meta.bid) : null;
  const ask =
    typeof meta.ask === 'number' && Number.isFinite(meta.ask) ? Number(meta.ask) : null;
  const marketCap =
    typeof meta.marketCap === 'number' && Number.isFinite(meta.marketCap)
      ? Number(meta.marketCap)
      : null;
  const week52High =
    typeof meta.fiftyTwoWeekHigh === 'number' && Number.isFinite(meta.fiftyTwoWeekHigh)
      ? Number(meta.fiftyTwoWeekHigh)
      : null;
  const week52Low =
    typeof meta.fiftyTwoWeekLow === 'number' && Number.isFinite(meta.fiftyTwoWeekLow)
      ? Number(meta.fiftyTwoWeekLow)
      : null;

  return {
    symbol: (meta.symbol ?? symbol).toUpperCase(),
    last,
    pctChange,
    valChange,
    previousClose,
    sessionOpen,
    volume,
    bid,
    ask,
    marketCap,
    week52High,
    week52Low,
  };
}

export async function upsertMark(
  symbol: string,
  price: number,
  source: string,
  dayPct?: number | null,
): Promise<void> {
  const now = new Date().toISOString();
  await query(
    `INSERT INTO marks (symbol, price, updated_at, source, day_pct) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (symbol) DO UPDATE SET
       price = EXCLUDED.price,
       updated_at = EXCLUDED.updated_at,
       source = EXCLUDED.source,
       day_pct = EXCLUDED.day_pct`,
    [symbol.toUpperCase(), price, now, source, dayPct ?? null],
  );
}

/** Symbols with open lots (net qty != 0) from a simplified action replay. */
export async function openSymbolsFromTrades(): Promise<string[]> {
  const res = await query<{
    symbol: string;
    action: string;
    quantity: number;
  }>(`SELECT symbol, action, quantity FROM trades ORDER BY date ASC, imported_at ASC`);

  const net = new Map<string, number>();
  for (const r of res.rows) {
    const sym = r.symbol.toUpperCase();
    const qty = Math.abs(Number(r.quantity));
    if (!qty) continue;
    const a = r.action.toLowerCase();
    const cur = net.get(sym) ?? 0;
    if (a.includes('short')) {
      net.set(sym, cur - qty);
    } else if (a.includes('cover')) {
      net.set(sym, cur + qty);
    } else if (a.includes('buy') || a.startsWith('bought')) {
      net.set(sym, cur + qty);
    } else if (a.includes('sell') || a.startsWith('sold')) {
      net.set(sym, cur - qty);
    }
  }

  return Array.from(net.entries())
    .filter(([, q]) => Math.abs(q) > 1e-8)
    .map(([s]) => s)
    .sort();
}

export async function refreshQuotes(extraSymbols: string[] = []): Promise<RefreshResult> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const updated: string[] = [];
    const failed: string[] = [];
    let error: string | undefined;

    try {
      const open = await openSymbolsFromTrades();
      const symbols = Array.from(
        new Set(
          [...open, ...extraSymbols]
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean),
        ),
      );

      const quotes = await fetchQuotesBatch(symbols);

      for (const symbol of symbols) {
        const quote = quotes.get(symbol);
        if (quote === null || quote === undefined) {
          failed.push(symbol);
          continue;
        }
        await upsertMark(symbol, quote.price, quote.source, quote.dayPct);
        updated.push(symbol);
      }

      lastRefreshAt = new Date().toISOString();
      lastRefreshError =
        failed.length && !updated.length ? (error ?? 'all quotes failed') : null;

      return {
        ok: updated.length > 0 || symbols.length === 0,
        updated,
        failed,
        error: lastRefreshError ?? undefined,
        refreshedAt: lastRefreshAt,
      };
    } catch (e) {
      lastRefreshError = String(e);
      lastRefreshAt = new Date().toISOString();
      return {
        ok: false,
        updated,
        failed,
        error: lastRefreshError,
        refreshedAt: lastRefreshAt,
      };
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function listMarksDetailed(): Promise<{
  marks: Record<string, MarkInfo>;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
}> {
  const res = await query<{
    symbol: string;
    price: number;
    updated_at: Date | string;
    source: string | null;
    day_pct: number | null;
  }>(`SELECT symbol, price, updated_at, source, day_pct FROM marks ORDER BY symbol`);

  const marks: Record<string, MarkInfo> = {};
  for (const r of res.rows) {
    const updatedAt =
      typeof r.updated_at === 'string' ? r.updated_at : r.updated_at.toISOString();
    marks[r.symbol] = {
      symbol: r.symbol,
      price: Number(r.price),
      updatedAt,
      source: r.source ?? 'manual',
      dayPct: r.day_pct !== null ? Number(r.day_pct) : null,
    };
  }
  return { marks, lastRefreshAt, lastRefreshError };
}

export async function getMarksHandler(c: Context) {
  const detailed = c.req.query('detailed') === '1' || c.req.query('detailed') === 'true';
  const data = await listMarksDetailed();
  if (detailed) {
    return c.json(data);
  }
  const out: Record<string, number> = {};
  for (const [sym, info] of Object.entries(data.marks)) {
    out[sym] = info.price;
  }
  return c.json(out);
}

export async function putMarksHandler(c: Context) {
  const body = await c.req.json();
  if (body && typeof body.symbol === 'string' && typeof body.price === 'number') {
    await upsertMark(body.symbol, body.price, 'manual');
    return c.json({ ok: true, symbol: body.symbol.toUpperCase(), price: body.price });
  }
  if (body && typeof body.marks === 'object' && body.marks !== null) {
    for (const [symbol, price] of Object.entries(body.marks as Record<string, unknown>)) {
      if (typeof price !== 'number') continue;
      await upsertMark(symbol, price, 'manual');
    }
    return c.json({ ok: true });
  }
  return c.json({ error: 'Expected { symbol, price } or { marks: Record }' }, 400);
}

export async function refreshQuotesHandler(c: Context) {
  let extra: string[] = [];
  try {
    if (c.req.method === 'POST') {
      const body = await c.req.json().catch(() => ({}));
      if (Array.isArray(body?.symbols)) {
        extra = body.symbols.filter((s: unknown) => typeof s === 'string');
      } else if (typeof body?.symbol === 'string') {
        extra = [body.symbol];
      }
    }
  } catch {
    // ignore
  }
  const qSym = c.req.query('symbol');
  if (qSym) extra.push(qSym);
  const result = await refreshQuotes(extra);
  return c.json(result, result.ok ? 200 : 502);
}

export function startQuoteRefreshCron(intervalMs = 30_000): void {
  // DISABLE in Cloudflare Workers (scheduled cron triggers too many subrequests on free tier)
  if (typeof process === 'undefined' || !process.versions?.node) {
    console.log('Quote refresh cron disabled in Workers environment');
    return;
  }
  
  setTimeout(() => {
    void refreshQuotes().catch((e) => console.error('quote refresh failed:', e));
  }, 5_000);

  setInterval(() => {
    void refreshQuotes().catch((e) => console.error('quote refresh failed:', e));
  }, intervalMs);

  console.log(`Quote refresh cron every ${Math.round(intervalMs / 1000)} seconds`);
}

export async function fetchYahooMeta(symbol: string): Promise<{
  price: number | null;
  shortName: string | null;
  longName: string | null;
  symbol: string;
}> {
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=true`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const data = (await res.json()) as {
    chart?: {
      result?: Array<{
        meta?: {
          regularMarketPrice?: number;
          fulldayPrice?: number;
          hasPrePostMarketData?: boolean;
          previousClose?: number;
          shortName?: string;
          longName?: string;
          symbol?: string;
          currentTradingPeriod?: {
            pre?: { start?: number; end?: number };
            regular?: { start?: number; end?: number };
            post?: { start?: number; end?: number };
          };
        };
      }>;
    };
  };
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`No meta for ${symbol}`);

  let price: number | null = null;
  const now = Math.floor(Date.now() / 1000);
  const regularStart = meta.currentTradingPeriod?.regular?.start;
  const regularEnd = meta.currentTradingPeriod?.regular?.end;
  const isRegularHours =
    regularStart != null && regularEnd != null && now >= regularStart && now < regularEnd;

  if (isRegularHours) {
    price = meta.regularMarketPrice ?? null;
  } else if (meta.hasPrePostMarketData && meta.fulldayPrice != null) {
    price = meta.fulldayPrice;
  }

  if (price === null || !Number.isFinite(price)) {
    price = meta.fulldayPrice ?? meta.regularMarketPrice ?? meta.previousClose ?? null;
  }

  return {
    price,
    shortName: meta.shortName ?? null,
    longName: meta.longName ?? null,
    symbol: meta.symbol ?? symbol,
  };
}
