/**
 * UNIFIED QUOTE SERVICE - Single source of truth for all pricing
 * 
 * Design principles:
 * 1. ONE refresh path: forceRefresh() - all UI and auto-refresh use this
 * 2. ONE symbol universe: union of all open positions + watchlist + research
 * 3. ONE storage: marks table (watchlist_quotes is derived view)
 * 4. ONE auto-refresh: 30s interval for ALL symbols when active
 * 5. Explicit errors: never silently fail, always surface issues to UI
 * 
 * What was removed:
 * - Hot/cold tier split (caused confusion about what gets refreshed when)
 * - Chunking (moved to caller if needed for CF limits)
 * - In-memory cache racing with DB (marks table is source of truth)
 * - Multiple refresh entry points (research.ts, watchlist.ts now delegate here)
 */

import { query } from './db.js';

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const USER_AGENT = 'Mozilla/5.0 (compatible; SeekTrack/1.0; +https://github.com/karthikl6333/Seek-Track)';
const REFRESH_INTERVAL_MS = 30_000; // 30 seconds - simple, predictable
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes - stop refreshing if no activity
const YAHOO_CONCURRENCY = 5; // Parallel Yahoo requests
const YAHOO_DELAY_MS = 80; // Delay between request batches
// CF Workers free tier limit: 50 subrequests per request
// Safe chunk size: 10 symbols per invocation (0 + 10 + 2 = 12 subrequests, well under limit)
export const MAX_SYMBOLS_PER_REFRESH = 10;

export interface QuoteData {
  symbol: string;
  price: number;
  dayPct: number | null;
  source: string;
  updatedAt: string;
  session: 'regular' | 'premarket' | 'afterhours' | 'unknown';
  // Rich metadata (for watchlist)
  bid: number | null;
  ask: number | null;
  volume: number | null;
  marketCap: number | null;
  week52High: number | null;
  week52Low: number | null;
  valChange: number | null;
  sessionOpen: number | null;
}

export interface YahooMeta {
  regularMarketPrice?: number;
  fulldayPrice?: number;
  hasPrePostMarketData?: boolean;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
  regularMarketTime?: number;
  bid?: number;
  ask?: number;
  marketCap?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  symbol?: string;
  currentTradingPeriod?: {
    pre?: { start?: number; end?: number };
    regular?: { start?: number; end?: number };
    post?: { start?: number; end?: number };
  };
}

export interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: YahooMeta;
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: { description?: string } | null;
  };
}

// Service state
let lastRefreshAt: string | null = null;
let lastRefreshError: string | null = null;
let refreshIntervalHandle: NodeJS.Timeout | null = null;
let lastActivityAt = Date.now();

// Per-request refresh tracking (no global lock)
const activeRefreshes = new Map<string, boolean>();

// 404 cache: symbols that returned 404, keyed by symbol, value is timestamp when they can be retried.
// The long skip only applies to symbols we have NEVER priced (no marks row). A symbol that already
// has a mark is retried after a short back-off; its last known price stays in marks untouched.
const cache404Symbols = new Map<string, number>();
export const NOT_FOUND_SKIP_NO_MARK_MS = 6 * 60 * 60 * 1000; // 6 hours (never-priced symbols)
export const NOT_FOUND_RETRY_WITH_MARK_MS = 10 * 60 * 1000; // 10 minutes (symbols with a last known mark)

/** Error carrying the upstream HTTP status so the batch fetcher can decide how to back off. */
export class YahooHttpError extends Error {
  constructor(public readonly status: number, symbol: string) {
    super(`Yahoo HTTP ${status} for ${symbol}`);
    this.name = 'YahooHttpError';
  }
}

/** A price we are willing to store/show: finite and strictly positive. Never null/0/NaN. */
export function isUsablePrice(p: unknown): p is number {
  return typeof p === 'number' && Number.isFinite(p) && p > 0;
}

/** Test helper: reset module-level caches. */
export function __resetQuoteServiceStateForTests(): void {
  cache404Symbols.clear();
  watchlistSymbolsCache = null;
  watchlistCacheTime = 0;
  lastRefreshAt = null;
  lastRefreshError = null;
}

/**
 * Determine current trading session
 */
function determineSession(meta: YahooMeta, now: number): 'regular' | 'premarket' | 'afterhours' | 'unknown' {
  const regularStart = meta.currentTradingPeriod?.regular?.start;
  const regularEnd = meta.currentTradingPeriod?.regular?.end;
  const preStart = meta.currentTradingPeriod?.pre?.start;
  const preEnd = meta.currentTradingPeriod?.pre?.end;
  const postStart = meta.currentTradingPeriod?.post?.start;
  const postEnd = meta.currentTradingPeriod?.post?.end;

  if (regularStart != null && regularEnd != null && now >= regularStart && now < regularEnd) {
    return 'regular';
  }
  if (preStart != null && preEnd != null && now >= preStart && now < preEnd) {
    return 'premarket';
  }
  if (postStart != null && postEnd != null && now >= postStart && now < postEnd) {
    return 'afterhours';
  }
  return 'unknown';
}

/**
 * Baseline for day % / val change: the close of the most recent regular session that
 * finished BEFORE the session the current price belongs to.
 *
 * Yahoo's chart meta (range=1d, includePrePost=true) exposes `previousClose` /
 * `chartPreviousClose` as the close *before the chart day*. During pre-market (and in the
 * overnight gap once Yahoo rolls `currentTradingPeriod` to the new day) the chart day is
 * the NEW day, but `regularMarketPrice` / `regularMarketTime` still describe yesterday's
 * regular close. In that window `previousClose` is two sessions back (e.g. GOOG on
 * 2026-10-08 pre-market: previousClose 344.59 = Oct 6 close, regularMarketPrice 347.37 =
 * Oct 7 close), so day % must be measured against `regularMarketPrice` instead.
 *
 * During regular hours and after-hours today's regular session has traded, so the baseline
 * is the previous day's close (`previousClose` ?? `chartPreviousClose`).
 */
export function dayChangeBaseline(meta: YahooMeta): number | null {
  const regularStart = meta.currentTradingPeriod?.regular?.start;
  const rmt = meta.regularMarketTime;
  const rmp = meta.regularMarketPrice;
  const todaysRegularNotStarted =
    typeof regularStart === 'number' && typeof rmt === 'number' && rmt < regularStart;
  if (todaysRegularNotStarted && isUsablePrice(rmp)) {
    return rmp;
  }
  const prev = meta.previousClose ?? meta.chartPreviousClose ?? null;
  return isUsablePrice(prev) ? prev : null;
}

/**
 * Pure parser: Yahoo chart JSON -> QuoteData. Throws if no usable price.
 * `nowSec` is injectable for tests.
 */
export function parseYahooChart(
  symbol: string,
  data: YahooChartResponse,
  nowSec: number = Math.floor(Date.now() / 1000),
  nowIso: string = new Date().toISOString(),
): QuoteData {
  const result = data.chart?.result?.[0];
  const meta = result?.meta;

  if (!meta) {
    throw new Error(data.chart?.error?.description || `No quote data for ${symbol}`);
  }

  const session = determineSession(meta, nowSec);

  // Price: last non-null 1m close (covers pre/post with includePrePost=true)
  let price: number | null = null;
  const priceCloses = result?.indicators?.quote?.[0]?.close ?? [];
  for (let i = priceCloses.length - 1; i >= 0; i--) {
    const closePrice = priceCloses[i];
    if (closePrice != null && Number.isFinite(closePrice)) {
      price = Number(closePrice);
      break;
    }
  }

  // Fallback if no bars: the last regular trade is the best "last known" price.
  // (previousClose is older than regularMarketPrice and only a last resort.)
  if (!isUsablePrice(price)) {
    price = [meta.regularMarketPrice, meta.previousClose, meta.chartPreviousClose].find(isUsablePrice) ?? null;
  }

  if (!isUsablePrice(price)) {
    throw new Error(`No price for ${symbol}`);
  }

  // Day % vs the previous regular-session close (see dayChangeBaseline). Stored in PERCENT units
  // (1.13 means +1.13%), never as a fraction.
  const baseline = dayChangeBaseline(meta);
  let dayPct: number | null = null;
  if (baseline !== null) {
    dayPct = ((price - baseline) / baseline) * 100;
  } else if (
    typeof meta.regularMarketChangePercent === 'number' &&
    Number.isFinite(meta.regularMarketChangePercent)
  ) {
    dayPct = meta.regularMarketChangePercent;
  }

  // Session open for val change calculation
  let sessionOpen: number | null = null;
  const timestamps = result?.timestamp ?? [];
  const opens = result?.indicators?.quote?.[0]?.open ?? [];
  const sessionStart = meta.currentTradingPeriod?.regular?.start;

  if (sessionStart && timestamps.length > 0) {
    const todayBarIndex = timestamps.findIndex((ts) => ts === sessionStart);
    if (todayBarIndex >= 0 && todayBarIndex < opens.length) {
      const openRaw = opens[todayBarIndex];
      if (openRaw != null && Number.isFinite(openRaw)) {
        sessionOpen = Number(openRaw);
      }
    }
  }

  // Val change ($): vs session open when today's regular session has an open bar, else vs baseline
  let valChange: number | null = null;
  if (sessionOpen !== null) {
    valChange = price - sessionOpen;
  } else if (baseline !== null) {
    valChange = price - baseline;
  }

  // Volume
  let volume: number | null =
    typeof meta.regularMarketVolume === 'number' && Number.isFinite(meta.regularMarketVolume)
      ? Number(meta.regularMarketVolume)
      : null;
  if (volume === null) {
    const vols = result?.indicators?.quote?.[0]?.volume ?? [];
    const lastVol = [...vols].reverse().find((v) => v != null && Number.isFinite(v));
    if (lastVol != null) volume = Number(lastVol);
  }

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Number(v) : null);

  return {
    symbol: (meta.symbol ?? symbol).toUpperCase(),
    price: Number(price),
    dayPct: dayPct !== null && Number.isFinite(dayPct) ? dayPct : null,
    source: 'yahoo',
    updatedAt: nowIso,
    session,
    bid: num(meta.bid),
    ask: num(meta.ask),
    volume,
    marketCap: num(meta.marketCap),
    week52High: num(meta.fiftyTwoWeekHigh),
    week52Low: num(meta.fiftyTwoWeekLow),
    valChange,
    sessionOpen,
  };
}

/**
 * Fetch a single symbol from Yahoo with full metadata (with timeout)
 */
async function fetchYahooQuote(
  symbol: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<QuoteData> {
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=true`;
  const res = await fetchImpl(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
    signal,
  });

  if (!res.ok) {
    throw new YahooHttpError(res.status, symbol);
  }

  const data = (await res.json()) as YahooChartResponse;
  return parseYahooChart(symbol, data);
}

export interface FetchBatchOptions {
  /** Symbols that already have a stored mark (last known price). */
  symbolsWithMark?: Set<string>;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable clock for tests. */
  now?: () => number;
}

/**
 * Batch fetch with controlled concurrency and per-fetch timeout.
 *
 * A null entry means "no fresh quote this round" (failed, timed out, or 404-skipped). Callers must
 * treat null as "keep the last known mark", never as "price is now empty".
 */
export async function fetchQuotesBatch(
  symbols: string[],
  opts: FetchBatchOptions = {},
): Promise<Map<string, QuoteData | null>> {
  const results = new Map<string, QuoteData | null>();
  const FETCH_TIMEOUT_MS = 5000; // 5s timeout per Yahoo fetch
  const nowFn = opts.now ?? Date.now;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const withMark = opts.symbolsWithMark ?? new Set<string>();

  // Filter out symbols still inside their 404 back-off window
  const now = nowFn();
  const symbolsToFetch: string[] = [];
  const skippedCached404: string[] = [];

  for (const symbol of symbols) {
    const retryAfter = cache404Symbols.get(symbol);
    if (retryAfter && now < retryAfter) {
      skippedCached404.push(symbol);
      results.set(symbol, null);
    } else {
      if (retryAfter) cache404Symbols.delete(symbol);
      symbolsToFetch.push(symbol);
    }
  }

  if (skippedCached404.length > 0) {
    console.log(
      `[QuoteService] Skipped ${skippedCached404.length} symbols still in 404 back-off: ${skippedCached404.join(', ')}`,
    );
  }

  for (let i = 0; i < symbolsToFetch.length; i += YAHOO_CONCURRENCY) {
    const chunk = symbolsToFetch.slice(i, i + YAHOO_CONCURRENCY);
    const chunkPromises = chunk.map(async (symbol) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const quote = await fetchYahooQuote(symbol, controller.signal, fetchImpl);
          results.set(symbol, quote);
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (err) {
        if (err instanceof YahooHttpError && err.status === 404) {
          const hasMark = withMark.has(symbol.toUpperCase());
          const backoff = hasMark ? NOT_FOUND_RETRY_WITH_MARK_MS : NOT_FOUND_SKIP_NO_MARK_MS;
          cache404Symbols.set(symbol, nowFn() + backoff);
          console.warn(
            `[QuoteService] ${symbol} returned 404; retry in ${backoff / 60000}m` +
              (hasMark ? ' (keeping last known mark)' : ' (no mark yet)'),
          );
        } else {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (errMsg.includes('aborted')) {
            console.error(`[QuoteService] Timeout fetching ${symbol} (${FETCH_TIMEOUT_MS}ms)`);
          } else {
            console.error(`[QuoteService] Failed to fetch ${symbol}:`, errMsg);
          }
        }
        results.set(symbol, null);
      }
    });

    await Promise.all(chunkPromises);

    if (i + YAHOO_CONCURRENCY < symbolsToFetch.length) {
      await new Promise((resolve) => setTimeout(resolve, YAHOO_DELAY_MS));
    }
  }

  return results;
}

/**
 * Build the complete symbol universe: ALL symbols that need pricing
 * This is the ONLY place that decides what symbols to refresh
 * 
 * Optimized for CF Workers: Single query combining all sources
 */
async function buildSymbolUniverse(): Promise<string[]> {
  const symbols = new Set<string>();

  // Single query combining all symbol sources (1 Neon query instead of 5)
  const allSymbolsRes = await query<{ symbol: string; source: string }>(
    `
    -- Holdings: compute net positions
    SELECT DISTINCT symbol, 'holdings' as source
    FROM trades
    GROUP BY symbol
    HAVING SUM(
      CASE 
        WHEN LOWER(action) LIKE '%short%' THEN -ABS(quantity)
        WHEN LOWER(action) LIKE '%cover%' THEN ABS(quantity)
        WHEN LOWER(action) LIKE '%buy%' OR LOWER(action) LIKE 'bought%' THEN ABS(quantity)
        WHEN LOWER(action) LIKE '%sell%' OR LOWER(action) LIKE 'sold%' THEN -ABS(quantity)
        ELSE 0
      END
    ) <> 0
    
    UNION
    
    -- Watchlist + research universe
    SELECT symbol, 'watchlist_research' as source FROM (
      SELECT symbol FROM watchlist
      UNION
      SELECT symbol FROM research_universe
    ) wr

    UNION

    -- Research ETFs, pair cache ETFs/underlyings, active price alerts.
    -- Nested so neither compound SELECT exceeds D1's limit on compound terms
    -- (a flat 7-term UNION fails on D1 with "too many terms in compound SELECT").
    SELECT symbol, 'etf_pair_alert' as source FROM (
      SELECT etf AS symbol FROM research_etf_map
      UNION
      SELECT etf AS symbol FROM pair_cache
      UNION
      SELECT underlying AS symbol FROM pair_cache
      UNION
      SELECT symbol FROM price_alerts WHERE status = 'active'
    ) epa
    `
  );

  for (const r of allSymbolsRes.rows) {
    const sym = r.symbol.toUpperCase().trim();
    // Exclude empty symbols and 'TEST' (Bug 7)
    if (sym.length > 0 && sym !== 'TEST') symbols.add(sym);
  }

  return Array.from(symbols).filter(s => s.length > 0 && s !== 'TEST').sort();
}

// Cache watchlist symbols to avoid repeated queries
let watchlistSymbolsCache: Set<string> | null = null;
let watchlistCacheTime = 0;
const WATCHLIST_CACHE_TTL_MS = 60_000; // 1 minute

async function getWatchlistSymbols(): Promise<Set<string>> {
  const now = Date.now();
  if (watchlistSymbolsCache && (now - watchlistCacheTime) < WATCHLIST_CACHE_TTL_MS) {
    return watchlistSymbolsCache;
  }
  
  const watchlistRes = await query<{ symbol: string }>(`SELECT symbol FROM watchlist`);
  watchlistSymbolsCache = new Set(watchlistRes.rows.map((r) => r.symbol.toUpperCase()));
  watchlistCacheTime = now;
  return watchlistSymbolsCache;
}

export interface ExistingMark {
  price: number;
  day_pct: number | null;
  session: string | null;
}

/** Read stored marks for a set of symbols (one D1 read). Keys are upper-cased. */
async function loadExistingMarks(symbols: string[]): Promise<Map<string, ExistingMark>> {
  if (symbols.length === 0) return new Map();
  const placeholders = symbols.map(() => '?').join(', ');
  const existingMarks = await query<{
    symbol: string;
    price: number;
    day_pct: number | null;
    session: string | null;
  }>(`SELECT symbol, price, day_pct, session FROM marks WHERE symbol IN (${placeholders})`, symbols);
  return new Map(
    existingMarks.rows.map((r) => [
      r.symbol.toUpperCase(),
      { price: Number(r.price), day_pct: r.day_pct == null ? null : Number(r.day_pct), session: r.session },
    ]),
  );
}

/**
 * Pure: decide which fresh quotes should be written.
 * - Only usable prices (finite, > 0) are ever written: a null/0/NaN quote can never overwrite a mark.
 * - Unchanged rows (same price, day % within 0.01, same session) are skipped to save D1 writes.
 */
export function selectQuotesToPersist(
  quotes: Map<string, QuoteData | null>,
  existing: Map<string, ExistingMark>,
): Map<string, QuoteData> {
  const changed = new Map<string, QuoteData>();
  for (const [symbol, quote] of quotes.entries()) {
    if (!quote || !isUsablePrice(quote.price)) continue;
    const prev = existing.get(symbol.toUpperCase());
    if (!prev || !isUsablePrice(prev.price)) {
      changed.set(symbol, quote);
      continue;
    }
    const priceChanged = Math.abs(prev.price - quote.price) > 0.0001;
    const dayPctChanged =
      (prev.day_pct === null) !== (quote.dayPct === null) ||
      (prev.day_pct !== null && quote.dayPct !== null && Math.abs(prev.day_pct - quote.dayPct) > 0.01);
    const sessionChanged = (prev.session ?? null) !== (quote.session ?? null);
    if (priceChanged || dayPctChanged || sessionChanged) {
      changed.set(symbol, quote);
    }
  }
  return changed;
}

/**
 * Update database with fresh quotes
 * Optimized for D1: Skip unchanged rows (write efficiency) and chunk to stay under 100 params
 */
async function persistQuotes(
  quotes: Map<string, QuoteData | null>,
  existingMarksMap: Map<string, ExistingMark>,
): Promise<void> {
  const changedQuotes = selectQuotesToPersist(quotes, existingMarksMap);

  if (changedQuotes.size === 0) {
    console.log('[QuoteService] No price/session changes detected, skipping DB write');
    return;
  }

  // Get watchlist symbols (cached, so only 1 query per minute across all chunks)
  const watchlistSet = await getWatchlistSymbols();

  console.log(`[QuoteService] Writing ${changedQuotes.size}/${quotes.size} changed quotes to DB`);

  // D1 allows max 100 bound params per query - chunk marks updates
  // Each mark row = 6 params (symbol, price, updated_at, source, day_pct, session)
  const MAX_MARKS_PER_CHUNK = Math.floor(100 / 6); // 16 marks per chunk

  const marksArray = Array.from(changedQuotes.entries());
  for (let i = 0; i < marksArray.length; i += MAX_MARKS_PER_CHUNK) {
    const chunk = marksArray.slice(i, i + MAX_MARKS_PER_CHUNK);
    const marksValues: string[] = [];
    const marksParams: unknown[] = [];
    let paramIndex = 1;

    for (const [symbol, quote] of chunk) {
      marksValues.push(
        `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5})`
      );
      marksParams.push(
        symbol,
        quote.price,
        quote.updatedAt,
        quote.source,
        quote.dayPct,
        quote.session
      );
      paramIndex += 6;
    }

    await query(
      `INSERT INTO marks (symbol, price, updated_at, source, day_pct, session)
       VALUES ${marksValues.join(', ')}
       ON CONFLICT (symbol) DO UPDATE SET
         price = EXCLUDED.price,
         updated_at = EXCLUDED.updated_at,
         source = EXCLUDED.source,
         day_pct = EXCLUDED.day_pct,
         session = EXCLUDED.session`,
      marksParams
    );
  }

  // Bulk upsert to watchlist_quotes (only watchlist symbols)
  // Each watchlist_quotes row = 12 params
  const MAX_WATCHLIST_PER_CHUNK = Math.floor(100 / 12); // 8 quotes per chunk

  const watchlistArray = Array.from(changedQuotes.entries()).filter(([symbol]) =>
    watchlistSet.has(symbol)
  );

  for (let i = 0; i < watchlistArray.length; i += MAX_WATCHLIST_PER_CHUNK) {
    const chunk = watchlistArray.slice(i, i + MAX_WATCHLIST_PER_CHUNK);
    const watchlistValues: string[] = [];
    const watchlistParams: unknown[] = [];
    let paramIndex = 1;

    for (const [symbol, quote] of chunk) {
      watchlistValues.push(
        `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, ` +
          `$${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, ` +
          `$${paramIndex + 10}, $${paramIndex + 11})`
      );
      watchlistParams.push(
        symbol,
        quote.price,
        quote.dayPct,
        quote.valChange,
        quote.sessionOpen,
        quote.bid,
        quote.ask,
        quote.marketCap,
        quote.volume,
        quote.week52High,
        quote.week52Low,
        quote.updatedAt
      );
      paramIndex += 12;
    }

    await query(
      `INSERT INTO watchlist_quotes
         (symbol, last, pct_change, val_change, session_open, bid, ask, market_cap, volume,
          week52_high, week52_low, updated_at)
       VALUES ${watchlistValues.join(', ')}
       ON CONFLICT (symbol) DO UPDATE SET
         last = COALESCE(EXCLUDED.last, watchlist_quotes.last),
         pct_change = EXCLUDED.pct_change,
         val_change = EXCLUDED.val_change,
         session_open = EXCLUDED.session_open,
         bid = COALESCE(EXCLUDED.bid, watchlist_quotes.bid),
         ask = COALESCE(EXCLUDED.ask, watchlist_quotes.ask),
         market_cap = COALESCE(EXCLUDED.market_cap, watchlist_quotes.market_cap),
         volume = COALESCE(EXCLUDED.volume, watchlist_quotes.volume),
         week52_high = COALESCE(EXCLUDED.week52_high, watchlist_quotes.week52_high),
         week52_low = COALESCE(EXCLUDED.week52_low, watchlist_quotes.week52_low),
         updated_at = EXCLUDED.updated_at`,
      watchlistParams
    );
  }
}

/**
 * THE refresh function - everything goes through here
 * 
 * SAFETY: Enforces CF Workers subrequest limits
 * - If symbols.length > MAX: returns error (caller must chunk)
 * - If no symbols: returns universe WITHOUT refreshing (caller must chunk)
 * 
 * Subrequest budget per invocation:
 * - Yahoo fetches: N (where N ≤ MAX_SYMBOLS_PER_REFRESH = 10)
 * - Persist: 2 Neon queries (marks + watchlist_quotes)
 * Total: N + 2 subrequests (N≤10 → ≤12 subrequests)
 * 
 * @param symbols - Specific symbols to refresh (REQUIRED for actual refresh)
 * @returns Refresh result OR chunking instructions
 */
export async function refreshAllPrices(
  symbols?: string[]
): Promise<{
  ok: boolean;
  updated: string[];
  failed: string[];
  stale?: string[];
  refreshedAt: string;
  error?: string;
  total: number;
  needsChunking?: boolean;
  universe?: string[];
  chunkSize?: number;
}> {
  // No symbols provided - return universe for caller to chunk
  if (!symbols || symbols.length === 0) {
    const universe = await buildSymbolUniverse();
    console.log(
      `[QuoteService] No symbols provided. Returning universe (${universe.length} symbols) for caller to chunk.`
    );
    return {
      ok: false,
      updated: [],
      failed: [],
      refreshedAt: lastRefreshAt ?? new Date().toISOString(),
      needsChunking: true,
      universe,
      chunkSize: MAX_SYMBOLS_PER_REFRESH,
      total: universe.length,
    };
  }

  // Normalize symbols (exclude empty and 'TEST')
  const universe = Array.from(
    new Set(symbols.map(s => s.trim().toUpperCase()).filter(s => s.length > 0 && s !== 'TEST'))
  ).sort();

  // Too many symbols - reject with error
  if (universe.length > MAX_SYMBOLS_PER_REFRESH) {
    console.error(
      `[QuoteService] Too many symbols: ${universe.length} (max ${MAX_SYMBOLS_PER_REFRESH}). ` +
      `Caller must chunk via GET /api/quotes/universe + multiple POST /api/quotes/refresh calls.`
    );
    return {
      ok: false,
      updated: [],
      failed: [],
      refreshedAt: lastRefreshAt ?? new Date().toISOString(),
      error: `Too many symbols: ${universe.length} (max ${MAX_SYMBOLS_PER_REFRESH} per request). Use GET /api/quotes/universe and chunk.`,
      total: universe.length,
    };
  }

  // Per-request tracking (no global lock - concurrent requests OK on different isolates)
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  activeRefreshes.set(requestId, true);

  const updated: string[] = [];
  const failed: string[] = [];
  /** failed this round but still have a last known mark (shown as-is with its age) */
  const stale: string[] = [];
  let error: string | undefined;

  try {
    const total = universe.length;

    if (universe.length === 0) {
      lastRefreshAt = new Date().toISOString();
      return {
        ok: true,
        updated: [],
        failed: [],
        refreshedAt: lastRefreshAt,
        total: 0,
      };
    }

    console.log(`[QuoteService] Refreshing ${universe.length} symbols (request ${requestId})`);

    // One read up front: which symbols already have a last known price. Used both for the
    // 404 back-off policy and for the changed-row check in persistQuotes (no extra D1 reads).
    const existingMarks = await loadExistingMarks(universe);
    const symbolsWithMark = new Set(
      Array.from(existingMarks.entries())
        .filter(([, m]) => isUsablePrice(m.price))
        .map(([s]) => s),
    );

    const startTime = Date.now();
    const quotes = await fetchQuotesBatch(universe, { symbolsWithMark });
    const fetchTime = Date.now() - startTime;

    for (const [symbol, quote] of quotes.entries()) {
      if (quote && isUsablePrice(quote.price)) {
        updated.push(symbol);
      } else {
        failed.push(symbol);
        if (symbolsWithMark.has(symbol.toUpperCase())) stale.push(symbol);
      }
    }

    // Only successful, usable quotes are written. Failed/skipped symbols keep their last mark.
    await persistQuotes(quotes, existingMarks);

    lastRefreshAt = new Date().toISOString();
    // Only an error when a symbol has NO price to show at all. Failures for symbols that still
    // have a last known mark are reported in `stale`, not as an error banner.
    const noPrice = failed.filter((s) => !symbolsWithMark.has(s.toUpperCase()));
    lastRefreshError =
      noPrice.length > 0 && updated.length === 0 ? `No price available for ${noPrice.join(', ')}` : null;

    // Evaluate price alerts after marks are updated
    if (updated.length > 0) {
      try {
        const { evaluateAlerts } = await import('./alerts.js');
        const alertResult = await evaluateAlerts();
        if (alertResult.triggered.length > 0) {
          console.log(`[QuoteService] Triggered ${alertResult.triggered.length} alerts`);
        }
      } catch (err) {
        console.error('[QuoteService] Alert evaluation failed:', err);
      }
    }

    console.log(
      `[QuoteService] Refreshed ${updated.length}/${universe.length} symbols in ${fetchTime}ms` +
      (failed.length > 0 ? ` (${failed.length} failed)` : '')
    );

    return {
      ok: updated.length > 0 || noPrice.length === 0,
      updated,
      failed,
      stale,
      refreshedAt: lastRefreshAt,
      error: lastRefreshError ?? undefined,
      total,
    };
  } catch (e) {
    error = String(e);
    lastRefreshError = error;
    lastRefreshAt = new Date().toISOString();
    console.error('[QuoteService] Refresh failed:', e);
    return {
      ok: false,
      updated,
      failed,
      stale,
      refreshedAt: lastRefreshAt,
      error,
      total: updated.length + failed.length,
    };
  } finally {
    activeRefreshes.delete(requestId);
  }
}

/**
 * Get the symbol universe without refreshing
 * Used by clients to chunk refresh across multiple HTTP calls
 */
export async function getSymbolUniverse(): Promise<string[]> {
  markActivity();
  return buildSymbolUniverse();
}

/**
 * Get service status
 */
export function getQuoteServiceStatus() {
  return {
    lastRefreshAt,
    lastRefreshError,
    activeRefreshCount: activeRefreshes.size,
    intervalActive: refreshIntervalHandle !== null,
  };
}

/**
 * Start the auto-refresh loop (Node.js only)
 */
export function startQuoteServiceLoop(): void {
  if (typeof process === 'undefined' || !process.versions?.node) {
    console.log('[QuoteService] Not starting loop (not Node.js)');
    return;
  }

  if (refreshIntervalHandle !== null) {
    console.log('[QuoteService] Loop already running');
    return;
  }

  console.log(`[QuoteService] Starting auto-refresh (${REFRESH_INTERVAL_MS}ms interval)`);

  // Initial refresh after 2 seconds
  setTimeout(() => {
    void refreshAllPrices();
  }, 2000);

  refreshIntervalHandle = setInterval(() => {
    const idleTime = Date.now() - lastActivityAt;
    if (idleTime > IDLE_TIMEOUT_MS) {
      console.log('[QuoteService] Idle timeout reached, pausing auto-refresh');
      return;
    }
    void refreshAllPrices();
  }, REFRESH_INTERVAL_MS);
}

/**
 * Stop the auto-refresh loop
 */
export function stopQuoteServiceLoop(): void {
  if (refreshIntervalHandle !== null) {
    clearInterval(refreshIntervalHandle);
    refreshIntervalHandle = null;
    console.log('[QuoteService] Stopped auto-refresh loop');
  }
}

/**
 * Mark activity to prevent idle shutdown
 */
export function markActivity(): void {
  lastActivityAt = Date.now();
}

/**
 * Force refresh on demand (for user-triggered refreshes and external callers)
 * 
 * @param symbols - Specific symbols to refresh (if empty/undefined, builds universe)
 */
export async function forceRefresh(symbols?: string[]): Promise<{
  ok: boolean;
  updated: string[];
  failed: string[];
  stale?: string[];
  refreshedAt: string;
  error?: string;
  total: number;
  needsChunking?: boolean;
  universe?: string[];
  chunkSize?: number;
}> {
  markActivity();
  return refreshAllPrices(symbols);
}
