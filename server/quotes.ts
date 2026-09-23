/**
 * Quote handlers - delegates to quote-service.ts for actual fetching/caching
 * Keeps only handlers and utilities needed by legacy code
 */
import type { Context } from 'hono';
import { query } from './db.js';
import { forceRefresh, getQuoteServiceStatus, markActivity } from './quote-service.js';

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

export async function listMarksDetailed(): Promise<{
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
  return {
    marks,
    lastRefreshAt: status.lastRefreshAt,
    lastRefreshError: status.lastRefreshError,
  };
}

export async function getMarksHandler(c: Context) {
  markActivity();
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

export async function refreshQuotesHandler(c: Context) {
  markActivity();
  let extra: string[] = [];
  let hotOnly = false;
  let chunkOffset = 0;
  let chunkLimit: number | undefined = undefined;
  
  try {
    if (c.req.method === 'POST') {
      const body = await c.req.json().catch(() => ({}));
      if (Array.isArray(body?.symbols)) {
        extra = body.symbols.filter((s: unknown) => typeof s === 'string');
      } else if (typeof body?.symbol === 'string') {
        extra = [body.symbol];
      }
      // Accept tier parameter: 'hot' or 'full'/'cold'
      if (body?.tier === 'hot') {
        hotOnly = true;
      }
      // Accept chunk parameters (for chunked cold refresh)
      if (typeof body?.chunkOffset === 'number') {
        chunkOffset = body.chunkOffset;
      }
      if (typeof body?.chunkLimit === 'number') {
        chunkLimit = body.chunkLimit;
      }
    }
  } catch {
    // ignore
  }
  
  const qSym = c.req.query('symbol');
  if (qSym) extra.push(qSym);
  
  const tierQuery = c.req.query('tier');
  if (tierQuery === 'hot') {
    hotOnly = true;
  }
  
  // For full/cold tier, always default to chunking to avoid subrequest limits
  // Hot tier stays unchunked (chunkLimit remains undefined)
  if (!hotOnly && chunkLimit === undefined) {
    chunkLimit = 25; // Default chunk size: 25 symbols per request
  }
  
  const result = await forceRefresh(extra, hotOnly, chunkOffset, chunkLimit);
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
