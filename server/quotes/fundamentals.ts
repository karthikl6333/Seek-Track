/**
 * Slow-moving fundamentals (market cap, shares outstanding, company name) for the watchlist.
 *
 * Yahoo's chart endpoint (used for prices) has no marketCap, so we use the v7 /finance/quote endpoint,
 * which batches many symbols in ONE call and includes marketCap + sharesOutstanding + shortName. It
 * needs a cookie + crumb (fc.yahoo.com -> /v1/test/getcrumb), cached in isolate memory.
 *
 * Cost control:
 *  - at most once per symbol per 24h (the gate lives in watchlist_quotes.fundamentals_updated_at, with an
 *    isolate-memory copy so a warm isolate does not even read it again);
 *  - one batched call for all due symbols (+ 2 crumb calls only when the crumb is missing/expired);
 *  - 401 -> refresh crumb once; 429/other failure -> isolate-wide back-off, last known values are kept.
 */

const YAHOO_COOKIE_URL = 'https://fc.yahoo.com';
const YAHOO_CRUMB_URL = 'https://query1.finance.yahoo.com/v1/test/getcrumb';
const YAHOO_QUOTE_URL = 'https://query1.finance.yahoo.com/v7/finance/quote';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const FUNDAMENTALS_TTL_MS = 24 * 60 * 60 * 1000;
/** Back-off after a 429 / network error / 5xx (honours Retry-After up to the cap). */
export const FUNDAMENTALS_BACKOFF_MS = 30 * 60 * 1000;
export const FUNDAMENTALS_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
/** A symbol Yahoo returned nothing for (delisted, bad ticker) is not retried for this long. */
export const FUNDAMENTALS_MISSING_RETRY_MS = 6 * 60 * 60 * 1000;
/** Max symbols per request: one batched call; keeps URL short and the subrequest budget tiny. */
export const FUNDAMENTALS_MAX_SYMBOLS = 10;
const CRUMB_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6_000;

export interface Fundamentals {
  symbol: string;
  marketCap: number | null;
  sharesOutstanding: number | null;
  /** regularMarketPrice at fetch time; the market cap is for this price. */
  capPrice: number | null;
  name: string | null;
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

/** Parse a v7 /finance/quote response into per-symbol fundamentals (unknown shapes -> []). */
export function parseQuoteFundamentals(json: unknown): Fundamentals[] {
  const result = (json as { quoteResponse?: { result?: unknown } } | null)?.quoteResponse?.result;
  if (!Array.isArray(result)) return [];
  const out: Fundamentals[] = [];
  for (const r of result as Array<Record<string, unknown>>) {
    const symbol = typeof r?.symbol === 'string' ? r.symbol.trim().toUpperCase() : '';
    if (!symbol) continue;
    const name =
      [r.shortName, r.longName].find((n): n is string => typeof n === 'string' && n.trim().length > 0)?.trim() ?? null;
    out.push({
      symbol,
      marketCap: num(r.marketCap),
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
// Isolate memory: crumb session, back-off, per-symbol gate
// ---------------------------------------------------------------------------------------------

interface CrumbSession {
  cookie: string;
  crumb: string;
  at: number;
}
let session: CrumbSession | null = null;
let backoffUntil = 0;
/** symbol -> ms before which we will not (re)check it (fresh in D1, or recently missing from Yahoo). */
const skipUntil = new Map<string, number>();

export function __resetFundamentalsStateForTests(): void {
  session = null;
  backoffUntil = 0;
  skipUntil.clear();
}

export function fundamentalsBackoffActive(nowMs = Date.now()): boolean {
  return nowMs < backoffUntil;
}

/** Remember that `symbol` was fetched at `updatedAtMs` so a warm isolate skips its D1 gate read. */
export function rememberFundamentalsFresh(symbol: string, updatedAtMs: number, ttlMs = FUNDAMENTALS_TTL_MS): void {
  skipUntil.set(symbol.toUpperCase(), updatedAtMs + ttlMs);
}

/** Forget the gate for a symbol (re-added after removal, so its D1 row is gone). */
export function forgetFundamentals(symbol: string): void {
  skipUntil.delete(symbol.toUpperCase());
}

/** Short in-flight hold so concurrent refreshes in this isolate do not fetch the same symbols twice. */
export function holdFundamentals(symbols: string[], nowMs: number, ms = 2 * 60 * 1000): void {
  for (const s of symbols) skipUntil.set(s.toUpperCase(), nowMs + ms);
}

export function rememberFundamentalsMissing(symbol: string, nowMs: number): void {
  skipUntil.set(symbol.toUpperCase(), nowMs + FUNDAMENTALS_MISSING_RETRY_MS);
}

/** In-memory pre-check: true if this isolate already knows the symbol does not need a check. */
export function isFundamentalsSkipped(symbol: string, nowMs: number): boolean {
  const until = skipUntil.get(symbol.toUpperCase());
  return until !== undefined && nowMs < until;
}

// ---------------------------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------------------------

type FetchImpl = typeof fetch;

function withTimeout(): { signal: AbortSignal; done: () => void } {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), FETCH_TIMEOUT_MS);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

function cookieFrom(res: Response): string | null {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const list = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [];
  const raw = list.length > 0 ? list : (res.headers.get('set-cookie') ?? '').split(/,(?=\s*[A-Za-z0-9_]+=)/);
  const pairs = raw.map((c) => c.split(';')[0].trim()).filter((c) => /^[A-Za-z0-9_]+=.+/.test(c));
  return pairs.length > 0 ? pairs.join('; ') : null;
}

async function acquireSession(fetchImpl: FetchImpl, nowMs: number): Promise<CrumbSession> {
  const t1 = withTimeout();
  let cookie: string | null;
  try {
    // fc.yahoo.com answers 404 but always sets the A3 session cookie.
    const r1 = await fetchImpl(YAHOO_COOKIE_URL, { headers: { 'User-Agent': USER_AGENT }, redirect: 'manual', signal: t1.signal });
    if (r1.status === 429) throw new FundamentalsHttpError(429, r1.headers.get('retry-after'));
    cookie = cookieFrom(r1);
  } finally {
    t1.done();
  }
  if (!cookie) throw new FundamentalsHttpError(0, null, 'no Yahoo session cookie');

  const t2 = withTimeout();
  try {
    const r2 = await fetchImpl(YAHOO_CRUMB_URL, { headers: { 'User-Agent': USER_AGENT, Cookie: cookie }, signal: t2.signal });
    if (!r2.ok) throw new FundamentalsHttpError(r2.status, r2.headers.get('retry-after'));
    const crumb = (await r2.text()).trim();
    if (!crumb || crumb.length > 64 || /[<\s]/.test(crumb)) throw new FundamentalsHttpError(0, null, 'bad crumb');
    return { cookie, crumb, at: nowMs };
  } finally {
    t2.done();
  }
}

export class FundamentalsHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfter: string | null,
    message?: string,
  ) {
    super(message ?? `Yahoo HTTP ${status}`);
    this.name = 'FundamentalsHttpError';
  }
}

async function callQuote(symbols: string[], s: CrumbSession, fetchImpl: FetchImpl): Promise<Response> {
  const url =
    `${YAHOO_QUOTE_URL}?symbols=${encodeURIComponent(symbols.join(','))}` +
    `&fields=${encodeURIComponent('marketCap,sharesOutstanding,shortName,longName,regularMarketPrice')}` +
    `&crumb=${encodeURIComponent(s.crumb)}`;
  const t = withTimeout();
  try {
    return await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', Cookie: s.cookie }, signal: t.signal });
  } finally {
    t.done();
  }
}

export interface FetchFundamentalsOptions {
  fetchImpl?: FetchImpl;
  now?: () => number;
}

/**
 * ONE batched v7 call for `symbols` (<= FUNDAMENTALS_MAX_SYMBOLS). Never throws: on any failure it
 * sets the isolate back-off and returns an empty map so callers keep the last known values.
 * Subrequests: 1 (crumb warm) or 3 (cold), plus 2 more only on a 401 crumb refresh.
 */
export async function fetchFundamentals(
  symbols: string[],
  opts: FetchFundamentalsOptions = {},
): Promise<Map<string, Fundamentals>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const out = new Map<string, Fundamentals>();
  const batch = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).slice(0, FUNDAMENTALS_MAX_SYMBOLS);
  if (batch.length === 0 || fundamentalsBackoffActive(now())) return out;

  try {
    if (!session || now() - session.at > CRUMB_TTL_MS) session = await acquireSession(fetchImpl, now());
    let res = await callQuote(batch, session, fetchImpl);
    if (res.status === 401 || res.status === 403) {
      session = await acquireSession(fetchImpl, now()); // crumb expired/rejected: one fresh attempt
      res = await callQuote(batch, session, fetchImpl);
    }
    if (!res.ok) throw new FundamentalsHttpError(res.status, res.headers.get('retry-after'));
    for (const f of parseQuoteFundamentals(await res.json())) out.set(f.symbol, f);
    return out;
  } catch (e) {
    if (e instanceof FundamentalsHttpError && (e.status === 401 || e.status === 403)) session = null;
    const retryAfter = e instanceof FundamentalsHttpError ? e.retryAfter : null;
    backoffUntil = now() + backoffFromRetryAfter(retryAfter, now());
    console.warn(`[Fundamentals] fetch failed (${e instanceof Error ? e.message : String(e)}); backing off`);
    return new Map();
  }
}
