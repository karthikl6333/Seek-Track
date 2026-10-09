/**
 * Quote handlers - delegates to quote-service.ts for actual fetching/caching
 * Keeps only handlers and utilities needed by legacy code
 */
import type { Context } from 'hono';
import { query } from './db.js';
import { cached } from './isolate-cache.js';
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
  // Never store a blank/zero/NaN price over a real mark.
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    throw new Error(`Refusing to store unusable price ${String(price)} for ${symbol}`);
  }
  // updated_at is stamped by the DB at write time (see persistQuotes): the SSE/?since= cursor
  // relies on stamps being (near-)monotonic in commit order.
  await query(
    `INSERT INTO marks (symbol, price, updated_at, source, day_pct) VALUES ($1, $2, NOW(), $3, $4)
     ON CONFLICT (symbol) DO UPDATE SET
       price = EXCLUDED.price,
       updated_at = EXCLUDED.updated_at,
       source = EXCLUDED.source,
       day_pct = EXCLUDED.day_pct`,
    [symbol.toUpperCase(), price, source, dayPct ?? null],
  );
}

type MarkRow = {
  symbol: string;
  price: number;
  updated_at: Date | string;
  source: string | null;
  day_pct: number | null;
  session: string | null;
};

/** Full marks table, cached per isolate (invalidated by any marks write in this isolate). */
export const MARKS_CACHE_TTL_MS = 15_000;

async function readAllMarkRows(): Promise<MarkRow[]> {
  return cached('marks:all', { ttlMs: MARKS_CACHE_TTL_MS, tables: ['marks'] }, async () => {
    const res = await query<MarkRow>(
      `SELECT symbol, price, updated_at, source, day_pct, session FROM marks ORDER BY symbol`,
    );
    return res.rows;
  });
}

function rowToMark(r: MarkRow): MarkInfo {
  const updatedAt = typeof r.updated_at === 'string' ? r.updated_at : r.updated_at.toISOString();
  return {
    symbol: r.symbol,
    price: Number(r.price),
    updatedAt,
    source: r.source ?? 'manual',
    dayPct: r.day_pct !== null ? Number(r.day_pct) : null,
    session: r.session as 'regular' | 'premarket' | 'afterhours' | 'unknown' | undefined,
  };
}

export async function listMarksDetailed(symbolsFilter?: string[]): Promise<{
  marks: Record<string, MarkInfo>;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
}> {
  const status = getQuoteServiceStatus();
  const rows = await readAllMarkRows();

  const marks: Record<string, MarkInfo> = {};
  let maxUpdatedAt: string | null = null;
  for (const r of rows) {
    const m = rowToMark(r);
    marks[r.symbol] = m;
    // Track max updated_at for filtered symbols (if provided) or all symbols
    if (!symbolsFilter || symbolsFilter.includes(r.symbol)) {
      if (!maxUpdatedAt || m.updatedAt > maxUpdatedAt) maxUpdatedAt = m.updatedAt;
    }
  }

  // Use DB max(updated_at) as lastRefreshAt (Bug 5 fix)
  return { marks, lastRefreshAt: maxUpdatedAt, lastRefreshError: status.lastRefreshError };
}

/**
 * Overlap applied to the delta cursor. marks.updated_at is stamped by the DB at write time
 * (NOW() inside the upsert), so stamps follow commit order; the overlap only covers clock skew /
 * same-millisecond writes. Rows re-read in the overlap are de-duplicated by (symbol, updated_at)
 * (see dedupeDelta), so a typical tick reads 0-10 rows through marks_updated_at_idx instead of the
 * whole table.
 */
export const INCREMENTAL_OVERLAP_MS = 2_000;
/** @deprecated kept for older imports/tests; same as INCREMENTAL_OVERLAP_MS. */
export const INCREMENTAL_LOOKBACK_MS = INCREMENTAL_OVERLAP_MS;

export function cursorWithLookback(cursor: string, lookbackMs = INCREMENTAL_OVERLAP_MS): string {
  const t = Date.parse(cursor);
  if (!Number.isFinite(t)) return cursor;
  return new Date(t - lookbackMs).toISOString();
}

/**
 * Pure: drop rows the receiver already has (same symbol AND same updated_at) and record what is
 * sent. Mutates `sent`. Returns only the new/changed rows.
 */
export function dedupeDelta(
  sent: Map<string, string>,
  marks: Record<string, MarkInfo>,
): Record<string, MarkInfo> {
  const changed: Record<string, MarkInfo> = {};
  for (const [sym, m] of Object.entries(marks)) {
    if (sent.get(sym) === m.updatedAt) continue;
    changed[sym] = m;
    sent.set(sym, m.updatedAt);
  }
  return changed;
}

/** Bound the dedupe map: forget entries older than the overlap window (they can't be re-read). */
export function pruneSent(sent: Map<string, string>, cursor: string, overlapMs = INCREMENTAL_OVERLAP_MS): void {
  const floor = cursorWithLookback(cursor, overlapMs * 2);
  for (const [sym, at] of sent) if (at < floor) sent.delete(sym);
}

/**
 * D1 optimization: read only marks changed since `cursor` (index seek on marks_updated_at_idx).
 * lastRefreshAt = new cursor (max updated_at seen, never earlier than the given cursor).
 */
/**
 * Stream-side cursor state. The overlap is only needed on the FIRST read after the cursor moved
 * (that's when a write stamped just before the cursor could still have been committing); after
 * that the read is strict (`> cursor`), so quiet ticks read 0 rows instead of re-reading the last
 * batch forever.
 */
export function createDeltaCursor(initial: string | null, overlapMs = INCREMENTAL_OVERLAP_MS) {
  let cursor = initial;
  let overlapPending = true;
  return {
    get value() {
      return cursor;
    },
    /** Overlap (ms) to use for the next read. */
    overlapMs(): number {
      return overlapPending ? overlapMs : 0;
    },
    /** Record the cursor returned by a read. */
    advance(next: string | null): void {
      if (next && (!cursor || next > cursor)) {
        cursor = next;
        overlapPending = true;
      } else {
        overlapPending = false;
      }
    },
  };
}

export async function listMarksDetailedIncremental(cursor: string, overlapMs = INCREMENTAL_OVERLAP_MS): Promise<{
  marks: Record<string, MarkInfo>;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
}> {
  const status = getQuoteServiceStatus();
  const res = await query<MarkRow>(
    `SELECT symbol, price, updated_at, source, day_pct, session
     FROM marks
     WHERE updated_at > $1
     ORDER BY updated_at`,
    [overlapMs > 0 ? cursorWithLookback(cursor, overlapMs) : cursor],
  );

  const marks: Record<string, MarkInfo> = {};
  let maxUpdatedAt: string | null = cursor;
  for (const r of res.rows) {
    const m = rowToMark(r);
    marks[r.symbol] = m;
    if (!maxUpdatedAt || m.updatedAt > maxUpdatedAt) maxUpdatedAt = m.updatedAt;
  }
  return { marks, lastRefreshAt: maxUpdatedAt, lastRefreshError: status.lastRefreshError };
}

/** A client-supplied cursor we accept: ISO-8601 that parses and isn't in the far future. */
export function parseSinceCursor(raw: string | undefined | null, nowMs = Date.now()): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t) || t > nowMs + 60_000) return null;
  return new Date(t).toISOString();
}

export async function getMarksHandler(c: Context) {
  markActivity();
  const detailed = c.req.query('detailed') === '1' || c.req.query('detailed') === 'true';
  // ?since=<cursor>: only rows changed since the client's newest known mark (index seek).
  // The client merges (never replaces), so a delta is safe. Without it: full (cached) read.
  const since = detailed ? parseSinceCursor(c.req.query('since')) : null;
  const data = since
    ? { ...(await listMarksDetailedIncremental(since)), incremental: true }
    : await listMarksDetailed();
  
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
    if (!Number.isFinite(body.price) || body.price <= 0) {
      return c.json({ error: 'price must be a positive number' }, 400);
    }
    await upsertMark(body.symbol, body.price, 'manual');
    return c.json({ ok: true, symbol: body.symbol.toUpperCase(), price: body.price });
  }
  if (body && typeof body.marks === 'object' && body.marks !== null) {
    for (const [symbol, price] of Object.entries(body.marks as Record<string, unknown>)) {
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue;
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
  // A completed refresh is a 200 even if some/all symbols failed upstream: failed symbols keep
  // their last known mark (listed in `stale`). 502 only when the refresh itself crashed
  // (e.g. D1 error) and nothing was attempted. Clients must never treat this as "prices empty".
  const attempted = result.updated.length + result.failed.length > 0;
  return c.json(result, result.ok || attempted ? 200 : 502);
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
