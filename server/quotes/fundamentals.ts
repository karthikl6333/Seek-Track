/**
 * Slow-moving fundamentals (market cap, shares outstanding, company name) for the watchlist:
 * pure helpers, the 24h gate and the isolate memory. The network side (provider chain) lives in
 * fundamentals-providers.ts.
 *
 * Yahoo's chart endpoint (used for prices) has no marketCap, and Yahoo's v7 quote endpoint answers 429
 * to Cloudflare IPs, so market cap comes from a chain of providers (see fundamentals-providers.ts).
 *
 * Cost control:
 *  - at most once per symbol per 24h (the gate lives in watchlist_quotes.fundamentals_updated_at, with an
 *    isolate-memory copy so a warm isolate does not even read it again);
 *  - a small per-refresh subrequest budget, one back-off per provider (30 min up to 6h, Retry-After);
 *  - last known values are always kept when every provider fails.
 */


export const FUNDAMENTALS_TTL_MS = 24 * 60 * 60 * 1000;
/** Back-off after a 429 / network error / 5xx (honours Retry-After up to the cap). */
export const FUNDAMENTALS_BACKOFF_MS = 30 * 60 * 1000;
export const FUNDAMENTALS_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
/** Max symbols per refresh (a refresh chunk is <= 10 symbols anyway). */
export const FUNDAMENTALS_MAX_SYMBOLS = 10;
/** Max outbound fetches the provider chain may spend in ONE refresh (Workers subrequest budget). */
export const FUNDAMENTALS_SUBREQUEST_BUDGET = 14;
/** SEC share counts change only with quarterly filings: cache them this long (isolate memory). */
export const SEC_SHARES_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ProviderId = 'finnhub' | 'nasdaq' | 'yahoo' | 'sec';

export interface Fundamentals {
  symbol: string;
  marketCap: number | null;
  sharesOutstanding: number | null;
  /** The live price the market cap is for (scales the cap intraday). */
  capPrice: number | null;
  name: string | null;
  /** Which provider supplied the market cap (log/diagnostics only; not stored). */
  provider?: ProviderId;
}

/** What the chain needs to know about a symbol: the live price (from the chart quote) and its type. */
export interface CapRequest {
  symbol: string;
  /** Last price from the chart quote fetched in this refresh (price x shares providers, cap_price). */
  price: number | null;
  /** Yahoo chart meta instrumentType (EQUITY, ETF, MUTUALFUND, ...), null when unknown. */
  instrumentType: string | null;
}

/** Stocks (and unknown types) can use stock-only providers (Nasdaq, SEC, Finnhub). ETFs/funds cannot. */
export function isStockLike(instrumentType: string | null | undefined): boolean {
  return !instrumentType || instrumentType.toUpperCase() === 'EQUITY';
}

/**
 * Display name from the chart meta. Yahoo's shortName is cut at 30 characters ("Defiance Daily Target 2X
 * Short " is the same for SMCZ, DAMD, MUZ and SPCQ), so the longName wins when shortName looks truncated.
 */
export function pickName(shortName: unknown, longName: unknown): string | null {
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, 80) : null);
  const s = clean(shortName);
  const l = clean(longName);
  if (s && l && typeof shortName === 'string' && shortName.length >= 30 && l.length > s.length) return l;
  return s ?? l;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

// ---------------------------------------------------------------------------------------------
// Pure helpers (tested)
// ---------------------------------------------------------------------------------------------

/**
 * Staleness gate: are fundamentals due for a refresh? True when never fetched (null / unparseable) or
 * older than 24h. A future timestamp (clock skew) is treated as fresh.
 */
export function isFundamentalsDue(updatedAt: string | Date | null | undefined, nowMs: number, ttlMs = FUNDAMENTALS_TTL_MS): boolean {
  if (updatedAt == null || updatedAt === '') return true;
  const t = updatedAt instanceof Date ? updatedAt.getTime() : Date.parse(String(updatedAt));
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= ttlMs;
}

/**
 * Market cap to show right now, never blank if anything is known:
 *  1. stored cap scaled by the live price move since it was fetched (moves intraday; correct for
 *     multi-class issuers like GOOGL where price x sharesOutstanding would undercount);
 *  2. the stored cap as-is (no live price / no price-at-fetch);
 *  3. live price x cached sharesOutstanding (cap never stored but shares are);
 *  4. null.
 */
export function effectiveMarketCap(p: {
  last: number | null;
  marketCap: number | null;
  capPrice: number | null;
  sharesOutstanding: number | null;
}): number | null {
  const last = num(p.last);
  const cap = num(p.marketCap);
  const capPrice = num(p.capPrice);
  const shares = num(p.sharesOutstanding);
  if (cap !== null) {
    if (last !== null && capPrice !== null) return cap * (last / capPrice);
    return cap;
  }
  if (shares !== null && last !== null) return last * shares;
  return null;
}

/** Parse a v7 /finance/quote response into per-symbol fundamentals (unknown shapes -> []). ETFs: netAssets. */
export function parseQuoteFundamentals(json: unknown): Fundamentals[] {
  const result = (json as { quoteResponse?: { result?: unknown } } | null)?.quoteResponse?.result;
  if (!Array.isArray(result)) return [];
  const out: Fundamentals[] = [];
  for (const r of result as Array<Record<string, unknown>>) {
    const symbol = typeof r?.symbol === 'string' ? r.symbol.trim().toUpperCase() : '';
    if (!symbol) continue;
    const name = pickName(r.shortName, r.longName);
    // ETFs/funds have no marketCap; their netAssets is the closest cheap equivalent.
    const isFund = typeof r.quoteType === 'string' && r.quoteType.toUpperCase() !== 'EQUITY';
    out.push({
      symbol,
      marketCap: num(r.marketCap) ?? (isFund ? num(r.netAssets) : null),
      sharesOutstanding: num(r.sharesOutstanding),
      capPrice: num(r.regularMarketPrice),
      name,
    });
  }
  return out;
}

/** Retry-After (seconds or HTTP date) -> ms, clamped to [back-off, max]; default back-off when absent. */
export function backoffFromRetryAfter(header: string | null, nowMs: number): number {
  if (!header) return FUNDAMENTALS_BACKOFF_MS;
  const secs = Number(header);
  let ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(header) - nowMs;
  if (!Number.isFinite(ms)) ms = FUNDAMENTALS_BACKOFF_MS;
  return Math.min(FUNDAMENTALS_BACKOFF_MAX_MS, Math.max(FUNDAMENTALS_BACKOFF_MS, ms));
}

// ---------------------------------------------------------------------------------------------
// Isolate memory: per-provider back-off, provider caches, per-symbol gates
// ---------------------------------------------------------------------------------------------

export interface CrumbSession {
  cookie: string;
  crumb: string;
  at: number;
}

/** Everything the provider chain remembers inside one isolate. Lost on a cold start (cheap to rebuild). */
export const providerState = {
  yahooSession: null as CrumbSession | null,
  /** ticker -> zero-padded CIK, from SEC company_tickers.json (loaded at most once per 7 days). */
  secTickers: null as { at: number; map: Map<string, string> } | null,
  /** symbol -> shares outstanding from SEC dei (7-day cache). */
  secShares: new Map<string, { at: number; shares: number }>(),
};

const providerBackoffUntil = new Map<ProviderId, number>();
/** symbol -> ms before which we will not (re)check it (fresh in D1, or held while a check is in flight). */
const skipUntil = new Map<string, number>();
/** symbols whose name was looked at in this isolate (D1 had one, or we filled it from the chart quote). */
const nameChecked = new Set<string>();

export function __resetFundamentalsStateForTests(): void {
  providerState.yahooSession = null;
  providerState.secTickers = null;
  providerState.secShares.clear();
  providerBackoffUntil.clear();
  skipUntil.clear();
  nameChecked.clear();
}

export function providerBackoffActive(id: ProviderId, nowMs = Date.now()): boolean {
  return nowMs < (providerBackoffUntil.get(id) ?? 0);
}

/** Start (or extend) a provider's back-off; honours Retry-After, clamped to [30 min, 6h]. */
export function setProviderBackoff(id: ProviderId, retryAfter: string | null, nowMs: number): number {
  const ms = backoffFromRetryAfter(retryAfter, nowMs);
  providerBackoffUntil.set(id, nowMs + ms);
  return ms;
}

/** Remember that `symbol` was fetched at `updatedAtMs` so a warm isolate skips its D1 gate read. */
export function rememberFundamentalsFresh(symbol: string, updatedAtMs: number, ttlMs = FUNDAMENTALS_TTL_MS): void {
  skipUntil.set(symbol.toUpperCase(), updatedAtMs + ttlMs);
}

/** Forget the gate for a symbol (re-added after removal, so its D1 row is gone). */
export function forgetFundamentals(symbol: string): void {
  skipUntil.delete(symbol.toUpperCase());
  nameChecked.delete(symbol.toUpperCase());
}

/** Short in-flight hold so concurrent refreshes in this isolate do not fetch the same symbols twice. */
export function holdFundamentals(symbols: string[], nowMs: number, ms = 2 * 60 * 1000): void {
  for (const s of symbols) skipUntil.set(s.toUpperCase(), nowMs + ms);
}

/** In-memory pre-check: true if this isolate already knows the symbol does not need a check. */
export function isFundamentalsSkipped(symbol: string, nowMs: number): boolean {
  const until = skipUntil.get(symbol.toUpperCase());
  return until !== undefined && nowMs < until;
}

export function isNameChecked(symbol: string): boolean {
  return nameChecked.has(symbol.toUpperCase());
}
export function markNameChecked(symbol: string): void {
  nameChecked.add(symbol.toUpperCase());
}
