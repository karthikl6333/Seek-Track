/**
 * Quote handlers - delegates to quote-service.ts for actual fetching/caching
 * Keeps only handlers and utilities needed by legacy code
 */
import type { Context } from 'hono';
import { query } from './db.js';
import { forceRefresh, getQuoteServiceStatus, getSymbolUniverse, markActivity } from './quote-service.js';

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const USER_AGENT =
  'Mozilla/5.0 (compatible; SeekTrack/1.0; +https://github.com/karthikl6333/Seek-Track)';

export interface MarkInfo {
  symbol: string;
  price: number;
  updatedAt: string;
  source: string;
  dayPct: number | null;
  session?: 'regular' | 'premarket' | 'afterhours' | 'unknown';
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

export async function listMarksDetailed(symbolsFilter?: string[]): Promise<{
  marks: Record<string, MarkInfo>;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
}> {
  const status = getQuoteServiceStatus();
  const res = await query<{
    symbol: string;
    price: number;
    updated_at: Date | string;
    source: string | null;
    day_pct: number | null;
    session: string | null;
  }>(`SELECT symbol, price, updated_at, source, day_pct, session FROM marks ORDER BY symbol`);

  const marks: Record<string, MarkInfo> = {};
  let maxUpdatedAt: string | null = null;
  
  for (const r of res.rows) {
    const updatedAt =
      typeof r.updated_at === 'string' ? r.updated_at : r.updated_at.toISOString();
    marks[r.symbol] = {
      symbol: r.symbol,
      price: Number(r.price),
      updatedAt,
      source: r.source ?? 'manual',
      dayPct: r.day_pct !== null ? Number(r.day_pct) : null,
      session: r.session as 'regular' | 'premarket' | 'afterhours' | 'unknown' | undefined,
    };
    
    // Track max updated_at for filtered symbols (if provided) or all symbols
    if (!symbolsFilter || symbolsFilter.includes(r.symbol)) {
      if (!maxUpdatedAt || updatedAt > maxUpdatedAt) {
        maxUpdatedAt = updatedAt;
      }
    }
  }
  
  // Use DB max(updated_at) as lastRefreshAt (Bug 5 fix)
  return {
    marks,
    lastRefreshAt: maxUpdatedAt,
    lastRefreshError: status.lastRefreshError,
  };
}

export async function getMarksHandler(c: Context) {
  markActivity();
  const detailed = c.req.query('detailed') === '1' || c.req.query('detailed') === 'true';
  const data = await listMarksDetailed();
  
  // Prevent caching of quote data (always fetch latest)
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');
  
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
  markActivity();
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

export async function getUniverseHandler(c: Context) {
  markActivity();
  try {
    const universe = await getSymbolUniverse();
    
    // Short cache for universe (5 seconds) since it doesn't change often
    c.header('Cache-Control', 'public, max-age=5');
    
    return c.json({ symbols: universe, total: universe.length });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
}

export async function refreshQuotesHandler(c: Context) {
  markActivity();
  let symbols: string[] | undefined = undefined;
  
  try {
    if (c.req.method === 'POST') {
      const body = await c.req.json().catch(() => ({}));
      if (Array.isArray(body?.symbols)) {
        symbols = body.symbols.filter((s: unknown) => typeof s === 'string');
      } else if (typeof body?.symbol === 'string') {
        symbols = [body.symbol];
      }
      // Legacy tier param: accept and ignore (chunking now at HTTP boundary)
      // Old clients may send ?tier=hot or ?tier=full - we don't error, just refresh provided symbols
    }
  } catch {
    // ignore
  }
  
  const qSym = c.req.query('symbol');
  if (qSym) {
    symbols = symbols || [];
    symbols.push(qSym);
  }
  
  // Legacy tier query param: accept and ignore
  // const tierQuery = c.req.query('tier'); // not used
  
  const result = await forceRefresh(symbols);
  
  // Prevent caching of quote refresh responses
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');
  
  // HTTP status codes:
  // - needsChunking: 200 (successful "here's the universe, please chunk" response)
  // - Too many symbols: 400 (client error, must chunk)
  // - Yahoo/Neon failure: 502 (upstream service error)
  // - Success: 200
  if (result.needsChunking) {
    return c.json(result, 200);
  }
  if (result.error && result.error.includes('Too many symbols')) {
    return c.json(result, 400);
  }
  return c.json(result, result.ok ? 200 : 502);
}

// Legacy cron function - now a no-op (replaced by quote-service)
export function startQuoteRefreshCron(_intervalMs = 30_000): void {
  console.log('[quotes.ts] startQuoteRefreshCron is deprecated - using quote-service instead');
}

/**
 * Fetch Yahoo meta (for adding new symbols to watchlist/research)
 * This is a one-time fetch, not part of the refresh cycle
 */
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
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            close?: Array<number | null>;
          }>;
        };
      }>;
    };
  };
  const result = data.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) throw new Error(`No meta for ${symbol}`);

  let price: number | null = null;
  const now = Math.floor(Date.now() / 1000);
  const regularStart = meta.currentTradingPeriod?.regular?.start;
  const regularEnd = meta.currentTradingPeriod?.regular?.end;
  const isRegularHours =
    regularStart != null && regularEnd != null && now >= regularStart && now < regularEnd;

  if (isRegularHours) {
    price = meta.regularMarketPrice ?? null;
  } else {
    // Outside regular hours: get last extended-hours bar close
    // Yahoo's fulldayPrice does NOT contain extended-hours data
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    for (let i = closes.length - 1; i >= 0; i--) {
      const closePrice = closes[i];
      if (closePrice != null && Number.isFinite(closePrice)) {
        price = Number(closePrice);
        break;
      }
    }
  }

  if (price === null || !Number.isFinite(price)) {
    price = meta.regularMarketPrice ?? meta.previousClose ?? null;
  }

  return {
    price,
    shortName: meta.shortName ?? null,
    longName: meta.longName ?? null,
    symbol: meta.symbol ?? symbol,
  };
}
