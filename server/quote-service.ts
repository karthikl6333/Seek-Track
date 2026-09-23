/**
 * Unified Quote Service - single source of truth for live pricing
 * 
 * Architecture:
 * - Builds "portal universe" from all price-display surfaces (holdings, watchlist, research, calculators)
 * - Maintains shared quote store in marks table + in-memory cache
 * - Refreshes on strict 15-second cadence while in use
 * - Batches Yahoo fetches with controlled concurrency
 * - Supports regular + after-hours pricing
 */

import { query } from './db.js';

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const USER_AGENT = 'Mozilla/5.0 (compatible; SeekTrack/1.0; +https://github.com/karthikl6333/Seek-Track)';
const REFRESH_INTERVAL_MS = 15_000; // 15 seconds
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes - stop refreshing if no activity
const YAHOO_CONCURRENCY = 5; // Parallel Yahoo requests
const YAHOO_DELAY_MS = 80; // Delay between requests in same batch

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

// In-memory cache for fast reads
const quoteCache = new Map<string, QuoteData>();
let lastRefreshAt: string | null = null;
let lastRefreshError: string | null = null;
let refreshIntervalHandle: NodeJS.Timeout | null = null;
let lastActivityAt = Date.now();
let isRefreshing = false;
let subscriberCount = 0;

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
        console.error(`Quote fetch failed for ${symbol}:`, err);
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
 * Build the portal universe: all symbols that need pricing
 */
async function buildPortalUniverse(): Promise<string[]> {
  const symbols = new Set<string>();

  // 1. Holdings (open positions from trades)
  const tradesRes = await query<{ symbol: string; action: string; quantity: number }>(
    `SELECT symbol, action, quantity FROM trades ORDER BY date ASC, imported_at ASC`
  );
  const netPositions = new Map<string, number>();
  for (const r of tradesRes.rows) {
    const sym = r.symbol.toUpperCase();
    const qty = Math.abs(Number(r.quantity));
    if (!qty) continue;
    const a = r.action.toLowerCase();
    const cur = netPositions.get(sym) ?? 0;
    if (a.includes('short')) {
      netPositions.set(sym, cur - qty);
    } else if (a.includes('cover')) {
      netPositions.set(sym, cur + qty);
    } else if (a.includes('buy') || a.startsWith('bought')) {
      netPositions.set(sym, cur + qty);
    } else if (a.includes('sell') || a.startsWith('sold')) {
      netPositions.set(sym, cur - qty);
    }
  }
  for (const [sym, qty] of netPositions.entries()) {
    if (Math.abs(qty) > 1e-8) symbols.add(sym);
  }

  // 2. Watchlist
  const watchlistRes = await query<{ symbol: string }>(`SELECT symbol FROM watchlist`);
  for (const r of watchlistRes.rows) {
    symbols.add(r.symbol.toUpperCase());
  }

  // 3. Research universe
  const researchRes = await query<{ symbol: string }>(`SELECT symbol FROM research_universe`);
  for (const r of researchRes.rows) {
    symbols.add(r.symbol.toUpperCase());
  }

  // 4. Research ETFs
  const etfsRes = await query<{ etf: string }>(`SELECT DISTINCT etf FROM research_etf_map`);
  for (const r of etfsRes.rows) {
    symbols.add(r.etf.toUpperCase());
  }

  // 5. Pair cache underlyings (for calculators)
  const pairsRes = await query<{ etf: string; underlying: string }>(`SELECT etf, underlying FROM pair_cache`);
  for (const r of pairsRes.rows) {
    symbols.add(r.etf.toUpperCase());
    symbols.add(r.underlying.toUpperCase());
  }

  return Array.from(symbols).sort();
}

/**
 * Update database with fresh quotes
 */
async function persistQuotes(quotes: Map<string, QuoteData>): Promise<void> {
  // Batch upsert to marks table
  for (const [symbol, quote] of quotes.entries()) {
    if (!quote) continue;
    
    // Update marks (main price store)
    await query(
      `INSERT INTO marks (symbol, price, updated_at, source, day_pct)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (symbol) DO UPDATE SET
         price = EXCLUDED.price,
         updated_at = EXCLUDED.updated_at,
         source = EXCLUDED.source,
         day_pct = EXCLUDED.day_pct`,
      [symbol, quote.price, quote.updatedAt, quote.source, quote.dayPct]
    );

    // Update watchlist_quotes if symbol is in watchlist
    const watchlistCheck = await query<{ symbol: string }>(
      `SELECT symbol FROM watchlist WHERE symbol = $1`,
      [symbol]
    );
    if (watchlistCheck.rows.length > 0) {
      await query(
        `INSERT INTO watchlist_quotes
           (symbol, last, pct_change, val_change, session_open, bid, ask, market_cap, volume,
            week52_high, week52_low, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        [
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
          quote.updatedAt,
        ]
      );
    }
  }
}

/**
 * Perform one refresh cycle
 */
export async function refreshQuoteService(): Promise<{
  ok: boolean;
  updated: string[];
  failed: string[];
  refreshedAt: string;
  error?: string;
}> {
  if (isRefreshing) {
    return {
      ok: false,
      updated: [],
      failed: [],
      refreshedAt: lastRefreshAt ?? new Date().toISOString(),
      error: 'Refresh already in progress',
    };
  }

  isRefreshing = true;
  const updated: string[] = [];
  const failed: string[] = [];
  let error: string | undefined;

  try {
    const universe = await buildPortalUniverse();
    console.log(`[QuoteService] Refreshing ${universe.length} symbols`);

    if (universe.length === 0) {
      lastRefreshAt = new Date().toISOString();
      return { ok: true, updated: [], failed: [], refreshedAt: lastRefreshAt };
    }

    const startTime = Date.now();
    const quotes = await fetchQuotesBatch(universe);
    const fetchTime = Date.now() - startTime;

    for (const [symbol, quote] of quotes.entries()) {
      if (quote) {
        quoteCache.set(symbol, quote);
        updated.push(symbol);
      } else {
        failed.push(symbol);
      }
    }

    await persistQuotes(new Map(Array.from(quotes.entries()).filter(([, q]) => q !== null) as [string, QuoteData][]));

    lastRefreshAt = new Date().toISOString();
    lastRefreshError = failed.length > 0 && updated.length === 0 ? 'All quotes failed' : null;

    console.log(
      `[QuoteService] Refreshed ${updated.length}/${universe.length} symbols in ${fetchTime}ms (${failed.length} failed)`
    );

    return {
      ok: updated.length > 0 || universe.length === 0,
      updated,
      failed,
      refreshedAt: lastRefreshAt,
      error: lastRefreshError ?? undefined,
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
    };
  } finally {
    isRefreshing = false;
  }
}

/**
 * Get cached quotes (fast read path)
 */
export function getCachedQuotes(): Map<string, QuoteData> {
  return new Map(quoteCache);
}

/**
 * Get status
 */
export function getQuoteServiceStatus() {
  return {
    lastRefreshAt,
    lastRefreshError,
    cacheSize: quoteCache.size,
    isRefreshing,
    subscriberCount,
    intervalActive: refreshIntervalHandle !== null,
  };
}

/**
 * Start the refresh loop (Node.js only)
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

  console.log(`[QuoteService] Starting refresh loop (${REFRESH_INTERVAL_MS}ms interval)`);

  // Initial refresh after 2 seconds
  setTimeout(() => {
    void refreshQuoteService();
  }, 2000);

  refreshIntervalHandle = setInterval(() => {
    const idleTime = Date.now() - lastActivityAt;
    if (idleTime > IDLE_TIMEOUT_MS && subscriberCount === 0) {
      console.log('[QuoteService] Idle timeout reached, pausing refresh');
      return;
    }
    void refreshQuoteService();
  }, REFRESH_INTERVAL_MS);
}

/**
 * Stop the refresh loop
 */
export function stopQuoteServiceLoop(): void {
  if (refreshIntervalHandle !== null) {
    clearInterval(refreshIntervalHandle);
    refreshIntervalHandle = null;
    console.log('[QuoteService] Stopped refresh loop');
  }
}

/**
 * Mark activity to prevent idle shutdown
 */
export function markActivity(): void {
  lastActivityAt = Date.now();
}

/**
 * Subscribe to updates (for client connections)
 */
export function subscribeToUpdates(): () => void {
  subscriberCount++;
  markActivity();
  console.log(`[QuoteService] Subscriber added (count: ${subscriberCount})`);

  return () => {
    subscriberCount = Math.max(0, subscriberCount - 1);
    console.log(`[QuoteService] Subscriber removed (count: ${subscriberCount})`);
  };
}

/**
 * Force refresh on demand (for user-triggered refreshes)
 */
export async function forceRefresh(extraSymbols?: string[]): Promise<{
  ok: boolean;
  updated: string[];
  failed: string[];
  refreshedAt: string;
  error?: string;
}> {
  markActivity();
  
  // Add extra symbols to the next refresh cycle by temporarily inserting them
  // (they'll be picked up by buildPortalUniverse if they're in any tracked table)
  if (extraSymbols && extraSymbols.length > 0) {
    // Just refresh - the universe builder will pick up everything
    console.log(`[QuoteService] Force refresh requested with ${extraSymbols.length} extra symbols`);
  }
  
  return refreshQuoteService();
}
