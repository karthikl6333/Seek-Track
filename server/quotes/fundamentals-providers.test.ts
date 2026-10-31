import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetFundamentalsStateForTests, providerBackoffActive, type CapRequest } from './fundamentals.js';
import {
  activeProviderIds,
  allProvidersBackedOff,
  fetchFundamentals,
  parseNasdaqMarketCap,
  parseSecShares,
  parseSecTickers,
} from './fundamentals-providers.js';

const NOW = Date.parse('2026-10-31T10:00:00Z');
const stock = (symbol: string, price = 100): CapRequest => ({ symbol, price, instrumentType: 'EQUITY' });
const etf = (symbol: string, price = 10): CapRequest => ({ symbol, price, instrumentType: 'ETF' });

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response> | undefined;

/** Fake fetch: routes by host; unhandled hosts fail the test loudly. Records every call. */
function fakeFetch(handlers: Record<string, Handler>) {
  const calls: string[] = [];
  const impl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push(input);
    const h = handlers[url.host];
    if (!h) throw new Error(`unexpected host ${url.host}`);
    const r = await h(url, init);
    if (!r) throw new Error(`unhandled ${input}`);
    return r;
  }) as unknown as typeof fetch;
  return { impl, calls, hosts: (host: string) => calls.filter((c) => new URL(c).host === host) };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const nasdaqBody = (cap: string) => ({ data: { summaryData: { MarketCap: { value: cap } } }, status: { rCode: 200 } });

const yahooHandlers = (result: unknown[] | 'fail429') => ({
  'fc.yahoo.com': () => new Response('', { status: 404, headers: { 'set-cookie': 'A3=d=abc; Path=/' } }),
  'query1.finance.yahoo.com': (u: URL) => {
    if (u.pathname.includes('getcrumb')) return new Response('crumb1', { status: 200 });
    return result === 'fail429' ? new Response('Too Many Requests', { status: 429 }) : json({ quoteResponse: { result } });
  },
  'query2.finance.yahoo.com': (u: URL) =>
    result === 'fail429' ? new Response('Too Many Requests', { status: 429 }) : json({ quoteResponse: { result } }),
});

let log: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  __resetFundamentalsStateForTests();
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const opts = (f: ReturnType<typeof fakeFetch>, extra: Record<string, unknown> = {}) => ({ fetchImpl: f.impl, now: () => NOW, env: {}, ...extra });

describe('parsers', () => {
  it('parseNasdaqMarketCap: "$1,234" strings; N/A and junk -> null', () => {
    expect(parseNasdaqMarketCap(nasdaqBody('$1,503,266,300,000'))).toBe(1_503_266_300_000);
    expect(parseNasdaqMarketCap(nasdaqBody('N/A'))).toBeNull();
    expect(parseNasdaqMarketCap({ data: null })).toBeNull();
    expect(parseNasdaqMarketCap(null)).toBeNull();
  });
  it('parseSecTickers pads the CIK to 10 digits and upper-cases tickers', () => {
    const m = parseSecTickers({ '0': { cik_str: 320193, ticker: 'aapl', title: 'Apple' }, '1': { nope: 1 } });
    expect(m.get('AAPL')).toBe('0000320193');
    expect(m.size).toBe(1);
  });
  it('parseSecShares takes the latest period (then latest filing) and drops stale/odd data', () => {
    const j = {
      units: {
        shares: [
          { end: '2026-01-20', filed: '2026-02-01', val: 100 },
          { end: '2026-07-20', filed: '2026-08-01', val: 120 },
          { end: '2026-07-20', filed: '2026-08-05', val: 125 },
          { end: '2026-09-01', filed: '2026-09-02', val: -1 },
        ],
      },
    };
    expect(parseSecShares(j, NOW)).toBe(125);
    expect(parseSecShares({ units: { shares: [{ end: '2020-01-01', val: 5 }] } }, NOW)).toBeNull();
    expect(parseSecShares({}, NOW)).toBeNull();
  });
});

describe('chain order and first-success wins', () => {
  it('stocks resolve at Nasdaq: no Yahoo / SEC traffic; logs provider=nasdaq', async () => {
    const f = fakeFetch({
      'api.nasdaq.com': (u) => json(nasdaqBody(u.pathname.includes('/AVGO/') ? '$1,500,000,000,000' : '$200,000,000,000')),
    });
    const r = await fetchFundamentals([stock('AVGO', 320), stock('MU', 100)], opts(f));
    expect(r.found.get('AVGO')).toMatchObject({ marketCap: 1.5e12, capPrice: 320, provider: 'nasdaq' });
    expect(r.found.get('MU')?.marketCap).toBe(2e11);
    expect(r.inconclusive.size).toBe(0);
    expect(f.calls.every((c) => c.startsWith('https://api.nasdaq.com/'))).toBe(true);
    expect(f.calls[0]).toContain('assetclass=stocks');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[Fundamentals] provider=nasdaq ok=2/2'));
  });

  it('Finnhub is first when FINNHUB_API_KEY is set (cap in millions) and absent otherwise', async () => {
    expect(activeProviderIds({})).toEqual(['nasdaq', 'yahoo', 'sec']);
    expect(activeProviderIds({ FINNHUB_API_KEY: 'k' })).toEqual(['finnhub', 'nasdaq', 'yahoo', 'sec']);
    let token: string | undefined;
    const f = fakeFetch({
      'finnhub.io': (_u, init) => {
        token = (init?.headers as Record<string, string>)['X-Finnhub-Token'];
        return json({ marketCapitalization: 1_500_000, shareOutstanding: 4_700, name: 'Broadcom Inc' });
      },
    });
    const r = await fetchFundamentals([stock('AVGO', 320)], opts(f, { env: { FINNHUB_API_KEY: 'secret-key' } }));
    expect(r.found.get('AVGO')).toMatchObject({ marketCap: 1.5e12, sharesOutstanding: 4.7e9, provider: 'finnhub' });
    expect(token).toBe('secret-key');
    expect(f.calls.some((c) => c.includes('secret-key'))).toBe(false); // never in a URL
    expect(f.hosts('api.nasdaq.com')).toHaveLength(0);
  });

  it('Nasdaq 400 (not a stock) is settled for that symbol; BRK-B is sent as BRK.B', async () => {
    const f = fakeFetch({
      'api.nasdaq.com': (u) => (u.pathname.includes('/ZZZZ/') ? json({ status: { rCode: 400 } }, 400) : json(nasdaqBody('$900,000,000,000'))),
      ...yahooHandlers([]),
      'www.sec.gov': () => json({}),
    });
    const r = await fetchFundamentals([stock('BRK-B'), stock('ZZZZ')], opts(f));
    expect(r.found.get('BRK-B')?.provider).toBe('nasdaq');
    expect(f.calls.some((c) => c.includes('/BRK.B/summary'))).toBe(true);
    expect(r.found.has('ZZZZ')).toBe(false);
    expect(r.inconclusive.has('ZZZZ')).toBe(false); // every provider answered "no value"
    expect(providerBackoffActive('nasdaq', NOW)).toBe(false);
  });
});

describe('fallback and back-off', () => {
  it('Nasdaq 429 -> that provider backs off, Yahoo supplies the cap; Nasdaq is not retried', async () => {
    const f = fakeFetch({
      'api.nasdaq.com': () => new Response('slow down', { status: 429, headers: { 'retry-after': '3600' } }),
      ...yahooHandlers([{ symbol: 'AVGO', quoteType: 'EQUITY', marketCap: 1.5e12, regularMarketPrice: 321 }]),
    });
    const r = await fetchFundamentals([stock('AVGO', 320)], opts(f));
    expect(r.found.get('AVGO')).toMatchObject({ marketCap: 1.5e12, provider: 'yahoo' });
    expect(providerBackoffActive('nasdaq', NOW + 3_000_000)).toBe(true);
    expect(providerBackoffActive('nasdaq', NOW + 3_700_000)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('provider=nasdaq failed'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('provider=yahoo ok=1/1'));
    const again = await fetchFundamentals([stock('MU')], opts(f, { now: () => NOW + 1000 }));
    expect(f.hosts('api.nasdaq.com')).toHaveLength(1);
    expect(again.found.get('MU')).toBeUndefined(); // yahoo fake has no MU: settled, not inconclusive
  });

  it('Nasdaq HTML/blocked page (200, non-JSON) counts as a provider failure', async () => {
    const f = fakeFetch({
      'api.nasdaq.com': () => new Response('<html>Access Denied</html>', { status: 200 }),
      ...yahooHandlers([{ symbol: 'MU', quoteType: 'EQUITY', marketCap: 1e11, regularMarketPrice: 100 }]),
    });
    const r = await fetchFundamentals([stock('MU')], opts(f));
    expect(r.found.get('MU')?.provider).toBe('yahoo');
    expect(providerBackoffActive('nasdaq', NOW + 1000)).toBe(true);
  });

  it('Yahoo tries query2 when query1 429s', async () => {
    const handlers = yahooHandlers([{ symbol: 'TSDD', quoteType: 'ETF', netAssets: 2.5e7, regularMarketPrice: 9 }]);
    handlers['query1.finance.yahoo.com'] = (u: URL) =>
      u.pathname.includes('getcrumb') ? new Response('crumb1', { status: 200 }) : new Response('no', { status: 429 });
    const f = fakeFetch(handlers);
    const r = await fetchFundamentals([etf('TSDD', 9)], opts(f));
    expect(r.found.get('TSDD')).toMatchObject({ marketCap: 2.5e7, provider: 'yahoo' });
    expect(f.hosts('query2.finance.yahoo.com')).toHaveLength(1);
    expect(providerBackoffActive('yahoo', NOW + 1000)).toBe(false);
  });

  it('ETFs skip the stock-only providers entirely (no Nasdaq / SEC / Finnhub calls)', async () => {
    const f = fakeFetch(yahooHandlers([{ symbol: 'SMCZ', quoteType: 'ETF', netAssets: 1e7, regularMarketPrice: 6 }]));
    const r = await fetchFundamentals([etf('SMCZ', 6)], opts(f, { env: { FINNHUB_API_KEY: 'k' } }));
    expect(r.found.get('SMCZ')?.marketCap).toBe(1e7);
    expect(f.calls.every((c) => c.includes('yahoo.com'))).toBe(true);
  });

  it('ETF with no net assets anywhere is settled (not inconclusive): shows "-", not retried for 24h', async () => {
    const f = fakeFetch(yahooHandlers([{ symbol: 'SMCZ', quoteType: 'ETF', regularMarketPrice: 6 }]));
    const r = await fetchFundamentals([etf('SMCZ', 6)], opts(f));
    expect(r.found.size).toBe(0);
    expect(r.inconclusive.size).toBe(0);
  });

  it('ETF while Yahoo is down is inconclusive (retry later), never stamped as "no value"', async () => {
    const f = fakeFetch(yahooHandlers('fail429'));
    const r = await fetchFundamentals([etf('SMCZ', 6)], opts(f));
    expect(r.found.size).toBe(0);
    expect(r.inconclusive.has('SMCZ')).toBe(true);
    expect(providerBackoffActive('yahoo', NOW + 1000)).toBe(true);
    const n = f.calls.length;
    const again = await fetchFundamentals([etf('SMCZ', 6)], opts(f, { now: () => NOW + 1000 }));
    expect(again.inconclusive.has('SMCZ')).toBe(true);
    expect(f.calls.length).toBe(n); // back-off active: the second lookup made no network request at all
  });

  it('SEC is the last resort: shares x live price, cached 7 days; multi-class issuers (404) stay unresolved', async () => {
    let conceptCalls = 0;
    const f = fakeFetch({
      'api.nasdaq.com': () => new Response('x', { status: 403 }),
      ...yahooHandlers('fail429'),
      'www.sec.gov': () => json({ '0': { cik_str: 1730168, ticker: 'AVGO' }, '1': { cik_str: 1652044, ticker: 'GOOG' } }),
      'data.sec.gov': (u) => {
        conceptCalls++;
        if (u.pathname.includes('CIK0001652044')) return new Response('nf', { status: 404 });
        return json({ units: { shares: [{ end: '2026-08-31', filed: '2026-09-10', val: 4_700_000_000 }] } });
      },
    });
    const r = await fetchFundamentals([stock('AVGO', 320), stock('GOOG', 300)], opts(f));
    expect(r.found.get('AVGO')).toMatchObject({ marketCap: 4_700_000_000 * 320, sharesOutstanding: 4.7e9, capPrice: 320, provider: 'sec' });
    expect(r.found.has('GOOG')).toBe(false);
    expect(r.inconclusive.has('GOOG')).toBe(true); // nasdaq + yahoo were down, SEC has no value
    const uaCall = f.hosts('data.sec.gov')[0];
    expect(uaCall).toBeTruthy();
    // a later lookup (providers still backed off): shares come from the 7-day cache -> cap follows the new price, no SEC request
    const n = f.calls.length;
    const r2 = await fetchFundamentals([stock('AVGO', 330)], opts(f, { now: () => NOW + 60_000 }));
    expect(r2.found.get('AVGO')?.marketCap).toBe(4_700_000_000 * 330);
    expect(f.calls.length).toBe(n);
    expect(conceptCalls).toBe(2);
  });

  it('SEC sends a descriptive User-Agent (SEC_USER_AGENT when set)', async () => {
    const seen: string[] = [];
    const f = fakeFetch({
      'api.nasdaq.com': () => new Response('x', { status: 403 }),
      ...yahooHandlers('fail429'),
      'www.sec.gov': (_u, init) => {
        seen.push((init?.headers as Record<string, string>)['User-Agent']);
        return json({ '0': { cik_str: 1, ticker: 'AVGO' } });
      },
      'data.sec.gov': () => json({ units: { shares: [{ end: '2026-08-31', val: 10 }] } }),
    });
    await fetchFundamentals([stock('AVGO')], opts(f, { env: { SEC_USER_AGENT: 'MyApp me@example.org' } }));
    expect(seen[0]).toBe('MyApp me@example.org');
  });

  it('subrequest budget: stops the chain, remaining symbols are inconclusive, nobody gets backed off', async () => {
    const f = fakeFetch({ 'api.nasdaq.com': () => json(nasdaqBody('$1,000')) });
    const syms = Array.from({ length: 8 }, (_, i) => stock(`S${i}`));
    const r = await fetchFundamentals(syms, opts(f, { budget: 4 }));
    expect(f.calls).toHaveLength(4);
    expect(r.found.size).toBe(4);
    expect(r.inconclusive.size).toBe(4);
    expect(providerBackoffActive('nasdaq', NOW + 1000)).toBe(false);
  });

  it('never throws, even when fetch itself blows up', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const r = await fetchFundamentals([stock('AVGO'), etf('TSDD')], { fetchImpl, now: () => NOW, env: {} });
    expect(r.found.size).toBe(0);
    expect(r.inconclusive.size).toBe(2);
  });

  it('allProvidersBackedOff only when every ENABLED provider is backed off', async () => {
    const f = fakeFetch({
      'api.nasdaq.com': () => new Response('x', { status: 429 }),
      ...yahooHandlers('fail429'),
      'www.sec.gov': () => new Response('x', { status: 403 }),
    });
    expect(allProvidersBackedOff(NOW, {})).toBe(false);
    await fetchFundamentals([stock('AVGO')], opts(f));
    expect(allProvidersBackedOff(NOW + 1000, {})).toBe(true);
    expect(allProvidersBackedOff(NOW + 1000, { FINNHUB_API_KEY: 'k' })).toBe(false); // finnhub not tried yet
  });
});
