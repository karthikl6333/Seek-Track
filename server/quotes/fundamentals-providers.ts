/**
 * Market-cap provider chain for the watchlist. Yahoo's v7 /finance/quote answers 429 to Cloudflare IPs,
 * so market cap is looked up through a chain of free sources, tried in order until every symbol has a value:
 *
 *   1. finnhub  /stock/profile2   - only when FINNHUB_API_KEY is set (free key); stocks only
 *   2. nasdaq   api.nasdaq.com    - no key; stocks only (its ETF "market cap" is not reliable)
 *   3. yahoo    v7 quote + crumb  - batched, query1 then query2; the only source of ETF net assets
 *   4. sec      EDGAR companyfacts dei:EntityCommonStockSharesOutstanding x live price; stocks only
 *
 * Each provider has its own back-off (30 min .. 6h, Retry-After), the whole chain shares a small per-refresh
 * subrequest budget, and every provider that supplies values logs `[Fundamentals] provider=<id>`.
 * Nothing here throws: on failure the caller keeps the last stored values.
 */
import {
  CapRequest,
  Fundamentals,
  FUNDAMENTALS_MAX_SYMBOLS,
  FUNDAMENTALS_SUBREQUEST_BUDGET,
  ProviderId,
  SEC_SHARES_TTL_MS,
  isStockLike,
  parseQuoteFundamentals,
  providerBackoffActive,
  providerState,
  setProviderBackoff,
  type CrumbSession,
} from './fundamentals.js';

type FetchImpl = typeof fetch;

export interface FundamentalsEnv {
  FINNHUB_API_KEY?: string;
  SEC_USER_AGENT?: string;
}

export interface FetchFundamentalsOptions {
  fetchImpl?: FetchImpl;
  now?: () => number;
  env?: FundamentalsEnv;
  /** Max outbound fetches for the whole chain (default FUNDAMENTALS_SUBREQUEST_BUDGET). */
  budget?: number;
}

export interface FetchFundamentalsResult {
  /** Symbols with a usable market cap, and the provider that supplied it. */
  found: Map<string, Fundamentals>;
  /** Symbols we could not settle (provider error / back-off / budget): retry later, do NOT stamp as done. */
  inconclusive: Set<string>;
}

const FETCH_TIMEOUT_MS = 6_000;
const CRUMB_TTL_MS = 6 * 60 * 60 * 1000;
const SEC_TICKERS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const YAHOO_COOKIE_URL = 'https://fc.yahoo.com';
const YAHOO_CRUMB_URL = 'https://query1.finance.yahoo.com/v1/test/getcrumb';
const YAHOO_QUOTE_URLS = ['https://query1.finance.yahoo.com/v7/finance/quote', 'https://query2.finance.yahoo.com/v7/finance/quote'];
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const NASDAQ_HEADERS = {
  'User-Agent': BROWSER_UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://www.nasdaq.com',
  Referer: 'https://www.nasdaq.com/',
};
const DEFAULT_SEC_UA = 'SeekTrack admin@seek-track.com';

export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderId,
    public readonly status: number,
    public readonly retryAfter: string | null,
    message?: string,
  ) {
    super(message ?? `${provider} HTTP ${status}`);
    this.name = 'ProviderError';
  }
}

class BudgetExhausted extends Error {
  constructor() {
    super('subrequest budget exhausted');
    this.name = 'BudgetExhausted';
  }
}

interface Ctx {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  now: () => number;
  env: FundamentalsEnv;
}

interface Outcome {
  found: Map<string, Fundamentals>;
  inconclusive: Set<string>;
  error?: unknown;
}

interface Provider {
  id: ProviderId;
  enabled(env: FundamentalsEnv): boolean;
  supports(req: CapRequest): boolean;
  run(reqs: CapRequest[], ctx: Ctx): Promise<Outcome>;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

function makeCtx(opts: FetchFundamentalsOptions): Ctx {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let left = opts.budget ?? FUNDAMENTALS_SUBREQUEST_BUDGET;
  return {
    now: opts.now ?? Date.now,
    env: opts.env ?? (typeof process !== 'undefined' ? (process.env as FundamentalsEnv) : {}),
    fetch: async (url, init) => {
      if (left <= 0) throw new BudgetExhausted();
      left--;
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), FETCH_TIMEOUT_MS);
      try {
        return await fetchImpl(url, { ...init, signal: c.signal });
      } finally {
        clearTimeout(t);
      }
    },
  };
}

/**
 * Per-symbol lookups in small waves. A `null` from `fn` means "this provider has no value for the
 * symbol" (settled). A throw stops the provider (circuit breaker): that wave and everything after it is
 * inconclusive, values found so far are kept.
 */
async function perSymbol(
  reqs: CapRequest[],
  concurrency: number,
  fn: (req: CapRequest) => Promise<Fundamentals | null>,
): Promise<Outcome> {
  const out: Outcome = { found: new Map(), inconclusive: new Set() };
  for (let i = 0; i < reqs.length; i += concurrency) {
    const wave = reqs.slice(i, i + concurrency);
    const settled = await Promise.allSettled(wave.map(fn));
    settled.forEach((r, j) => {
      const sym = wave[j].symbol;
      if (r.status === 'fulfilled') {
        if (r.value && r.value.marketCap != null) out.found.set(sym, r.value);
      } else {
        out.inconclusive.add(sym);
        out.error ??= r.reason;
      }
    });
    if (out.error) {
      for (const rest of reqs.slice(i + concurrency)) out.inconclusive.add(rest.symbol);
      break;
    }
  }
  return out;
}

async function readJson(provider: ProviderId, res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError(provider, 0, null, `${provider} returned non-JSON (blocked?)`);
  }
}

function httpError(provider: ProviderId, res: Response): ProviderError {
  return new ProviderError(provider, res.status, res.headers.get('retry-after'));
}

// ---------------------------------------------------------------------------------------------
// 1. Finnhub (optional free key)
// ---------------------------------------------------------------------------------------------
const finnhub: Provider = {
  id: 'finnhub',
  enabled: (env) => !!env.FINNHUB_API_KEY,
  supports: (r) => isStockLike(r.instrumentType),
  run: (reqs, ctx) =>
    perSymbol(reqs, 4, async (req) => {
      const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(req.symbol)}`;
      const res = await ctx.fetch(url, { headers: { 'X-Finnhub-Token': ctx.env.FINNHUB_API_KEY ?? '', Accept: 'application/json' } });
      if (res.status === 404) return null;
      if (!res.ok) throw httpError('finnhub', res);
      const j = await readJson('finnhub', res);
      const capM = num(j?.marketCapitalization); // millions of USD
      if (capM == null) return null;
      const sharesM = num(j?.shareOutstanding);
      return {
        symbol: req.symbol,
        marketCap: capM * 1e6,
        sharesOutstanding: sharesM != null ? sharesM * 1e6 : null,
        capPrice: req.price,
        name: null,
        provider: 'finnhub',
      };
    }),
};

// ---------------------------------------------------------------------------------------------
// 2. Nasdaq (no key, browser-like headers, stocks only)
// ---------------------------------------------------------------------------------------------
export function parseNasdaqMarketCap(j: any): number | null {
  const raw = j?.data?.summaryData?.MarketCap?.value;
  if (typeof raw !== 'string') return null;
  const n = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const nasdaq: Provider = {
  id: 'nasdaq',
  enabled: () => true,
  supports: (r) => isStockLike(r.instrumentType),
  run: (reqs, ctx) =>
    perSymbol(reqs, 4, async (req) => {
      // Yahoo writes share classes with '-' (BRK-B); Nasdaq with '.'.
      const sym = req.symbol.replace(/-/g, '.');
      const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/summary?assetclass=stocks`;
      const res = await ctx.fetch(url, { headers: NASDAQ_HEADERS });
      // 400 = "not a stock" / unknown symbol for this asset class: settled, nothing to retry.
      if (res.status === 400 || res.status === 404) return null;
      if (!res.ok) throw httpError('nasdaq', res);
      const marketCap = parseNasdaqMarketCap(await readJson('nasdaq', res));
      if (marketCap == null) return null;
      return { symbol: req.symbol, marketCap, sharesOutstanding: null, capPrice: req.price, name: null, provider: 'nasdaq' };
    }),
};

// ---------------------------------------------------------------------------------------------
// 3. Yahoo v7 quote with cookie + crumb (batched; ETFs get netAssets)
// ---------------------------------------------------------------------------------------------
function cookieFrom(res: Response): string | null {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const list = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [];
  const raw = list.length > 0 ? list : (res.headers.get('set-cookie') ?? '').split(/,(?=\s*[A-Za-z0-9_]+=)/);
  const pairs = raw.map((c) => c.split(';')[0].trim()).filter((c) => /^[A-Za-z0-9_]+=.+/.test(c));
  return pairs.length > 0 ? pairs.join('; ') : null;
}

async function acquireYahooSession(ctx: Ctx): Promise<CrumbSession> {
  // fc.yahoo.com answers 404 but always sets the A3 session cookie.
  const r1 = await ctx.fetch(YAHOO_COOKIE_URL, { headers: { 'User-Agent': BROWSER_UA }, redirect: 'manual' });
  if (r1.status === 429) throw httpError('yahoo', r1);
  const cookie = cookieFrom(r1);
  if (!cookie) throw new ProviderError('yahoo', 0, null, 'no Yahoo session cookie');
  const r2 = await ctx.fetch(YAHOO_CRUMB_URL, { headers: { 'User-Agent': BROWSER_UA, Cookie: cookie } });
  if (!r2.ok) throw httpError('yahoo', r2);
  const crumb = (await r2.text()).trim();
  if (!crumb || crumb.length > 64 || /[<\s]/.test(crumb)) throw new ProviderError('yahoo', 0, null, 'bad Yahoo crumb');
  return { cookie, crumb, at: ctx.now() };
}

async function yahooQuote(symbols: string[], s: CrumbSession, ctx: Ctx): Promise<Response> {
  let last: Response | null = null;
  for (const base of YAHOO_QUOTE_URLS) {
    const url =
      `${base}?symbols=${encodeURIComponent(symbols.join(','))}` +
      `&fields=${encodeURIComponent('marketCap,netAssets,quoteType,sharesOutstanding,shortName,longName,regularMarketPrice')}` +
      `&crumb=${encodeURIComponent(s.crumb)}`;
    last = await ctx.fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json', Cookie: s.cookie } });
    if (last.status !== 429 && last.status < 500) return last; // query2 is a second chance only for 429/5xx
  }
  return last as Response;
}

const yahoo: Provider = {
  id: 'yahoo',
  enabled: () => true,
  supports: () => true,
  async run(reqs, ctx) {
    const out: Outcome = { found: new Map(), inconclusive: new Set() };
    const symbols = reqs.map((r) => r.symbol);
    try {
      let session = providerState.yahooSession;
      if (!session || ctx.now() - session.at > CRUMB_TTL_MS) session = providerState.yahooSession = await acquireYahooSession(ctx);
      let res = await yahooQuote(symbols, session, ctx);
      if (res.status === 401 || res.status === 403) {
        session = providerState.yahooSession = await acquireYahooSession(ctx); // crumb expired/rejected: one retry
        res = await yahooQuote(symbols, session, ctx);
      }
      if (!res.ok) throw httpError('yahoo', res);
      const priceBySymbol = new Map(reqs.map((r) => [r.symbol, r.price]));
      for (const f of parseQuoteFundamentals(await readJson('yahoo', res))) {
        if (f.marketCap == null || !priceBySymbol.has(f.symbol)) continue;
        out.found.set(f.symbol, { ...f, capPrice: f.capPrice ?? priceBySymbol.get(f.symbol) ?? null, provider: 'yahoo' });
      }
    } catch (e) {
      if (e instanceof ProviderError && (e.status === 401 || e.status === 403)) providerState.yahooSession = null;
      out.error = e;
      for (const s of symbols) out.inconclusive.add(s);
    }
    return out;
  },
};

// ---------------------------------------------------------------------------------------------
// 4. SEC EDGAR: shares outstanding (cover page) x live price. Stocks only; no multi-class issuers.
// ---------------------------------------------------------------------------------------------
function secUserAgent(env: FundamentalsEnv): string {
  // SEC fair-access policy wants a real contact in the User-Agent: set SEC_USER_AGENT ("AppName email").
  return env.SEC_USER_AGENT?.trim() || DEFAULT_SEC_UA;
}

export function parseSecTickers(j: any): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of Object.values(j ?? {}) as any[]) {
    if (row && typeof row.ticker === 'string' && row.cik_str != null) {
      map.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, '0'));
    }
  }
  return map;
}

/** Latest dei:EntityCommonStockSharesOutstanding value (by period end, then filing date), or null. */
export function parseSecShares(j: any, nowMs: number): number | null {
  const rows = j?.units?.shares;
  if (!Array.isArray(rows)) return null;
  let best: { end: string; filed: string; val: number } | null = null;
  for (const r of rows) {
    const val = num(r?.val);
    if (val == null || typeof r?.end !== 'string') continue;
    const filed = typeof r.filed === 'string' ? r.filed : '';
    if (!best || r.end > best.end || (r.end === best.end && filed > best.filed)) best = { end: r.end, filed, val };
  }
  if (!best) return null;
  const endMs = Date.parse(best.end);
  if (Number.isFinite(endMs) && nowMs - endMs > 800 * 24 * 3600 * 1000) return null; // stale: delisted / acquired
  return best.val;
}

const sec: Provider = {
  id: 'sec',
  enabled: () => true,
  supports: (r) => isStockLike(r.instrumentType) && r.price != null,
  async run(reqs, ctx) {
    const out: Outcome = { found: new Map(), inconclusive: new Set() };
    const headers = { 'User-Agent': secUserAgent(ctx.env), Accept: 'application/json' };
    const now = ctx.now();
    const need: CapRequest[] = [];
    for (const r of reqs) {
      const cached = providerState.secShares.get(r.symbol);
      if (cached && now - cached.at < SEC_SHARES_TTL_MS) {
        out.found.set(r.symbol, { symbol: r.symbol, marketCap: cached.shares * r.price!, sharesOutstanding: cached.shares, capPrice: r.price, name: null, provider: 'sec' });
      } else need.push(r);
    }
    if (need.length === 0) return out;

    try {
      if (!providerState.secTickers || now - providerState.secTickers.at > SEC_TICKERS_TTL_MS) {
        const res = await ctx.fetch('https://www.sec.gov/files/company_tickers.json', { headers });
        if (!res.ok) throw httpError('sec', res);
        providerState.secTickers = { at: now, map: parseSecTickers(await readJson('sec', res)) };
      }
    } catch (e) {
      out.error = e;
      for (const r of need) out.inconclusive.add(r.symbol);
      return out;
    }
    const tickers = providerState.secTickers.map;
    const withCik = need.filter((r) => tickers.has(r.symbol));
    const sub = await perSymbol(withCik, 3, async (req) => {
      const cik = tickers.get(req.symbol)!;
      const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/dei/EntityCommonStockSharesOutstanding.json`;
      const res = await ctx.fetch(url, { headers });
      if (res.status === 404) return null; // no single dei total (multi-class issuer) or not an XBRL filer
      if (!res.ok) throw httpError('sec', res);
      const shares = parseSecShares(await readJson('sec', res), now);
      if (shares == null) return null;
      providerState.secShares.set(req.symbol, { at: now, shares });
      return { symbol: req.symbol, marketCap: shares * req.price!, sharesOutstanding: shares, capPrice: req.price, name: null, provider: 'sec' as const };
    });
    for (const [k, v] of sub.found) out.found.set(k, v);
    for (const k of sub.inconclusive) out.inconclusive.add(k);
    out.error = sub.error;
    return out;
  },
};

// ---------------------------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------------------------
const CHAIN: Provider[] = [finnhub, nasdaq, yahoo, sec];

function envOf(env?: FundamentalsEnv): FundamentalsEnv {
  return env ?? (typeof process !== 'undefined' ? (process.env as FundamentalsEnv) : {});
}

export function activeProviderIds(env?: FundamentalsEnv): ProviderId[] {
  const e = envOf(env);
  return CHAIN.filter((p) => p.enabled(e)).map((p) => p.id);
}

/** True when every enabled provider is in back-off (nothing to try until one lapses). */
export function allProvidersBackedOff(nowMs: number, env?: FundamentalsEnv): boolean {
  return activeProviderIds(env).every((id) => providerBackoffActive(id, nowMs));
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Look up market caps for <= FUNDAMENTALS_MAX_SYMBOLS symbols. Never throws.
 *  - `found`: symbols with a cap (first provider that has one wins).
 *  - `inconclusive`: symbols some eligible provider could not answer (error, back-off, budget): retry later.
 *  - neither: every eligible provider answered "no value" (ETF without net assets, unknown ticker): settled.
 */
export async function fetchFundamentals(requests: CapRequest[], opts: FetchFundamentalsOptions = {}): Promise<FetchFundamentalsResult> {
  const ctx = makeCtx(opts);
  const seen = new Set<string>();
  const batch = requests
    .map((r) => ({ ...r, symbol: r.symbol.toUpperCase() }))
    .filter((r) => (seen.has(r.symbol) ? false : (seen.add(r.symbol), true)))
    .slice(0, FUNDAMENTALS_MAX_SYMBOLS);
  const result: FetchFundamentalsResult = { found: new Map(), inconclusive: new Set() };
  const nowMs = ctx.now();

  for (const p of CHAIN) {
    if (!p.enabled(ctx.env)) continue;
    const eligible = batch.filter((r) => !result.found.has(r.symbol) && p.supports(r));
    if (eligible.length === 0) continue;
    if (providerBackoffActive(p.id, nowMs)) {
      for (const r of eligible) result.inconclusive.add(r.symbol);
      continue;
    }
    let outcome: Outcome;
    try {
      outcome = await p.run(eligible, ctx);
    } catch (e) {
      outcome = { found: new Map(), inconclusive: new Set(eligible.map((r) => r.symbol)), error: e };
    }
    for (const [sym, f] of outcome.found) {
      result.found.set(sym, f);
      result.inconclusive.delete(sym);
    }
    for (const sym of outcome.inconclusive) if (!result.found.has(sym)) result.inconclusive.add(sym);
    if (outcome.found.size > 0) {
      console.log(`[Fundamentals] provider=${p.id} ok=${outcome.found.size}/${eligible.length} symbols=${Array.from(outcome.found.keys()).join(',')}`);
    }
    if (outcome.error) {
      if (outcome.error instanceof BudgetExhausted) {
        console.warn(`[Fundamentals] provider=${p.id} stopped: subrequest budget exhausted`);
        for (const r of batch) if (!result.found.has(r.symbol) && p.supports(r)) result.inconclusive.add(r.symbol);
        // later providers cannot fetch either: everything unresolved stays inconclusive
        for (const r of batch) if (!result.found.has(r.symbol)) result.inconclusive.add(r.symbol);
        break;
      }
      const retryAfter = outcome.error instanceof ProviderError ? outcome.error.retryAfter : null;
      const ms = setProviderBackoff(p.id, retryAfter, nowMs);
      console.warn(`[Fundamentals] provider=${p.id} failed (${describe(outcome.error)}); backing off ${Math.round(ms / 60000)}m`);
    }
  }
  return result;
}
