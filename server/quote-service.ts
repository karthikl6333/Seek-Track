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

interface YahooMeta {
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

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: YahooMeta;
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
}

// Service state
let lastRefreshAt: string | null = null;
let lastRefreshError: string | null = null;
let refreshIntervalHandle: NodeJS.Timeout | null = null;
let lastActivityAt = Date.now();
let isRefreshing = false;

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
 * Fetch a single symbol from Yahoo with full metadata
 */
async function fetchYahooQuote(symbol: string): Promise<QuoteData> {
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

  const data = (await res.json()) as YahooChartResponse;
  const result = data.chart?.result?.[0];
  const meta = result?.meta;

  if (!meta) {
    throw new Error(data.chart?.error?.description || `No quote data for ${symbol}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const session = determineSession(meta, now);
  const isRegularHours = session === 'regular';

  // Price selection: regular market price during RTH, fulldayPrice in extended hours
  let price: number | null = null;
  if (isRegularHours) {
    price = meta.regularMarketPrice ?? null;
  } else if (meta.hasPrePostMarketData && meta.fulldayPrice != null) {
    price = meta.fulldayPrice;
  }

  // Fallback cascade
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

  // Session open for val change calculation
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

  // Val change
  let valChange: number | null = null;
  if (sessionOpen !== null) {
    valChange = price - sessionOpen;
  } else if (previousClose !== null) {
    valChange = price - previousClose;
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

  const bid = typeof meta.bid === 'number' && Number.isFinite(meta.bid) ? Number(meta.bid) : null;
  const ask = typeof meta.ask === 'number' && Number.isFinite(meta.ask) ? Number(meta.ask) : null;
  const marketCap = typeof meta.marketCap === 'number' && Number.isFinite(meta.marketCap) ? Number(meta.marketCap) : null;
  const week52High = typeof meta.fiftyTwoWeekHigh === 'number' && Number.isFinite(meta.fiftyTwoWeekHigh) ? Number(meta.fiftyTwoWeekHigh) : null;
  const week52Low = typeof meta.fiftyTwoWeekLow === 'number' && Number.isFinite(meta.fiftyTwoWeekLow) ? Number(meta.fiftyTwoWeekLow) : null;

  return {
    symbol: (meta.symbol ?? symbol).toUpperCase(),
    price: Number(price),
    dayPct: dayPct !== null && Number.isFinite(dayPct) ? dayPct : null,
    source: 'yahoo',
    updatedAt: new Date().toISOString(),
    session,
    bid,
    ask,
    volume,
    marketCap,
    week52High,
    week52Low,
    valChange,
    sessionOpen,
  };
}

/**
 * Batch fetch with controlled concurrency
 */
async function fetchQuotesBatch(symbols: string[]): Promise<Map<string, QuoteData | null>> {
  const results = new Map<string, QuoteData | null>();
  
  // Process in chunks with controlled concurrency
  for (let i = 0; i < symbols.length; i += YAHOO_CONCURRENCY) {
    const chunk = symbols.slice(i, i + YAHOO_CONCURRENCY);
    const chunkPromises = chunk.map(async (symbol) => {
      try {
        const quote = await fetchYahooQuote(symbol);
        results.set(symbol, quote);
      } catch (err) {
        console.error(`[QuoteService] Failed to fetch ${symbol}:`, err);
        results.set(symbol, null);
      }
    });
    
    await Promise.all(chunkPromises);
    
    // Delay between chunks (not after last chunk)
    if (i + YAHOO_CONCURRENCY < symbols.length) {
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
    
    -- Watchlist
    SELECT symbol, 'watchlist' as source FROM watchlist
    
    UNION
    
    -- Research universe
    SELECT symbol, 'research' as source FROM research_universe
    
    UNION
    
    -- Research ETFs
    SELECT etf as symbol, 'etf' as source FROM research_etf_map
    
    UNION
    
    -- Pair cache ETFs
    SELECT etf as symbol, 'pair_etf' as source FROM pair_cache
    
    UNION
    
    -- Pair cache underlyings
    SELECT underlying as symbol, 'pair_underlying' as source FROM pair_cache
    `
  );

  for (const r of allSymbolsRes.rows) {
    const sym = r.symbol.toUpperCase().trim();
    if (sym.length > 0) symbols.add(sym);
  }

  return Array.from(symbols).filter(s => s.length > 0).sort();
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

/**
 * Update database with fresh quotes
 * Optimized for CF Workers: 2 Neon queries per call (marks + watchlist_quotes)
 */
async function persistQuotes(quotes: Map<string, QuoteData>): Promise<void> {
  if (quotes.size === 0) return;

  // Get watchlist symbols (cached, so only 1 query per minute across all chunks)
  const watchlistSet = await getWatchlistSymbols();

  // Bulk upsert to marks table (all symbols) - 1 query
  const marksValues: string[] = [];
  const marksParams: unknown[] = [];
  let paramIndex = 1;
  
  for (const [symbol, quote] of quotes.entries()) {
    marksValues.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`);
    marksParams.push(symbol, quote.price, quote.updatedAt, quote.source, quote.dayPct);
    paramIndex += 5;
  }

  // Bulk upsert to watchlist_quotes (only watchlist symbols) - 1 query
  const watchlistValues: string[] = [];
  const watchlistParams: unknown[] = [];
  paramIndex = 1;

  for (const [symbol, quote] of quotes.entries()) {
    if (!watchlistSet.has(symbol)) continue;

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

  // Execute both upserts in parallel (2 queries total)
  await Promise.all([
    marksValues.length > 0 ? query(
      `INSERT INTO marks (symbol, price, updated_at, source, day_pct)
       VALUES ${marksValues.join(', ')}
       ON CONFLICT (symbol) DO UPDATE SET
         price = EXCLUDED.price,
         updated_at = EXCLUDED.updated_at,
         source = EXCLUDED.source,
         day_pct = EXCLUDED.day_pct`,
      marksParams
    ) : Promise.resolve(),
    watchlistValues.length > 0 ? query(
      `INSERT INTO watchlist_quotes
         (symbol, last, pct_change, val_change, session_open, bid, ask, market_cap, volume,
          week52_high, week52_low, updated_at)
       VALUES ${watchlistValues.join(', ')}
       ON CONFLICT (symbol) DO UPDATE SET
         last = EXCLUDED.last,
         pct_change = EXCLUDED.pct_change,
         val_change = EXCLUDED.val_change,
         session_open = EXCLUDED.session_open,
         bid = EXCLUDED.bid,
         ask = EXCLUDED.ask,
         market_cap = EXCLUDED.market_cap,
         volume = EXCLUDED.volume,
         week52_high = EXCLUDED.week52_high,
         week52_low = EXCLUDED.week52_low,
         updated_at = EXCLUDED.updated_at`,
      watchlistParams
    ) : Promise.resolve(),
  ]);
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
  refreshedAt: string;
  error?: string;
  total: number;
  needsChunking?: boolean;
  universe?: string[];
  chunkSize?: number;
}> {
  if (isRefreshing) {
    return {
      ok: false,
      updated: [],
      failed: [],
      refreshedAt: lastRefreshAt ?? new Date().toISOString(),
      error: 'Refresh already in progress',
      total: 0,
    };
  }

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

  // Normalize symbols
  const universe = Array.from(
    new Set(symbols.map(s => s.trim().toUpperCase()).filter(s => s.length > 0))
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

  isRefreshing = true;
  const updated: string[] = [];
  const failed: string[] = [];
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

    console.log(`[QuoteService] Refreshing ${universe.length} symbols`);

    const startTime = Date.now();
    const quotes = await fetchQuotesBatch(universe);
    const fetchTime = Date.now() - startTime;

    for (const [symbol, quote] of quotes.entries()) {
      if (quote) {
        updated.push(symbol);
      } else {
        failed.push(symbol);
      }
    }

    // Only persist successful quotes
    const successQuotes = new Map(
      Array.from(quotes.entries()).filter(([, q]) => q !== null) as [string, QuoteData][]
    );
    await persistQuotes(successQuotes);

    lastRefreshAt = new Date().toISOString();
    lastRefreshError = failed.length > 0 && updated.length === 0 ? 'All quotes failed' : null;

    console.log(
      `[QuoteService] Refreshed ${updated.length}/${universe.length} symbols in ${fetchTime}ms` +
      (failed.length > 0 ? ` (${failed.length} failed)` : '')
    );

    return {
      ok: updated.length > 0 || universe.length === 0,
      updated,
      failed,
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
      refreshedAt: lastRefreshAt,
      error,
      total: updated.length + failed.length,
    };
  } finally {
    isRefreshing = false;
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
    isRefreshing,
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
