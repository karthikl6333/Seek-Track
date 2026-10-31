import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the D1 adapter: records every statement and serves the marks table.
const marks = new Map<string, { price: number; day_pct: number | null; session: string | null }>();
const statements: Array<{ sql: string; params: unknown[] }> = [];
let watchlistSymbols: string[] = [];
const wq = new Map<string, { short_name: string | null; fundamentals_updated_at: string | null }>();

vi.mock('../db.js', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    statements.push({ sql, params });
    if (/FROM marks WHERE symbol IN/i.test(sql)) {
      return {
        rows: (params as string[])
          .filter((s) => marks.has(s))
          .map((s) => ({ symbol: s, ...marks.get(s)! })),
        rowCount: 0,
      };
    }
    if (/^\s*SELECT symbol FROM watchlist\s*$/i.test(sql)) {
      return { rows: watchlistSymbols.map((symbol) => ({ symbol })), rowCount: 0 };
    }
    if (/FROM watchlist_quotes WHERE symbol IN/i.test(sql)) {
      return {
        rows: (params as string[]).filter((s) => wq.has(s)).map((s) => ({ symbol: s, ...wq.get(s)! })),
        rowCount: 0,
      };
    }
    if (/INSERT INTO watchlist_quotes[\s\S]*cap_price = CASE/i.test(sql)) {
      for (let i = 0; i < params.length; i += 6) {
        wq.set(String(params[i]), { short_name: params[i + 4] as string | null, fundamentals_updated_at: params[i + 5] as string });
      }
    }
    if (/INSERT INTO marks/i.test(sql)) {
      for (let i = 0; i < params.length; i += 6) {
        marks.set(String(params[i]), {
          price: params[i + 1] as number,
          day_pct: params[i + 4] as number | null,
          session: params[i + 5] as string | null,
        });
      }
    }
    return { rows: [], rowCount: 0 };
  }),
}));

const { refreshAllPrices, __resetQuoteServiceStateForTests } = await import('./quote-service.js');

function yahooOk(price: number, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      chart: {
        result: [
          {
            meta: {
              regularMarketPrice: price,
              previousClose: price,
              ...extra,
              currentTradingPeriod: { regular: { start: 1, end: 9_999_999_999 } },
            },
            timestamp: [1],
            indicators: { quote: [{ close: [price], open: [price], volume: [1] }] },
          },
        ],
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('refreshAllPrices keeps last known marks on failure', () => {
  beforeEach(() => {
    __resetQuoteServiceStateForTests();
    marks.clear();
    wq.clear();
    statements.length = 0;
    marks.set('AMDU', { price: 25.133, day_pct: -6.57, session: null });
    marks.set('AMDS', { price: 13.12, day_pct: 0.153, session: null });
    marks.set('AVGO', { price: 370, day_pct: -1.5, session: 'regular' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        /AMDU|AMDS|NEWX/.test(url) ? new Response('nope', { status: 404 }) : yahooOk(371.25),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not touch marks for 404 symbols and reports them as stale, not as an error', async () => {
    const res = await refreshAllPrices(['AMDU', 'AMDS', 'AVGO']);

    expect(res.updated).toEqual(['AVGO']);
    expect(res.failed.sort()).toEqual(['AMDS', 'AMDU']);
    expect(res.stale?.sort()).toEqual(['AMDS', 'AMDU']);
    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();

    // Last known prices survive untouched
    expect(marks.get('AMDU')?.price).toBe(25.133);
    expect(marks.get('AMDS')?.price).toBe(13.12);
    expect(marks.get('AVGO')?.price).toBe(371.25);

    // And no write statement ever carried the failed symbols or a null/0 price
    const writes = statements.filter((s) => /INSERT INTO (marks|watchlist_quotes)/i.test(s.sql));
    for (const w of writes) {
      expect(w.params).not.toContain('AMDU');
      expect(w.params).not.toContain('AMDS');
    }
  });

  it('an all-failed chunk where every symbol has a mark is still ok (no error banner)', async () => {
    const res = await refreshAllPrices(['AMDU', 'AMDS']);
    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();
    expect(statements.some((s) => /INSERT INTO marks/i.test(s.sql))).toBe(false);
  });

  it('reports an error only when a symbol has no price at all', async () => {
    const res = await refreshAllPrices(['NEWX']);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/NEWX/);
  });
});

describe('watchlist_quotes persistence of name / 52-wk from the one chart response', () => {
  beforeEach(() => {
    __resetQuoteServiceStateForTests();
    marks.clear();
    wq.clear();
    statements.length = 0;
    watchlistSymbols = ['AVGO'];
    marks.set('AVGO', { price: 370, day_pct: -1.5, session: 'regular' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        yahooOk(371.25, { shortName: 'Broadcom Inc.', fiftyTwoWeekHigh: 495, fiftyTwoWeekLow: 289.96, regularMarketVolume: 1234 }),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    watchlistSymbols = [];
  });

  it('writes short_name + 52-wk in the SAME watchlist_quotes upsert (13 params/row), with no extra reads', async () => {
    await refreshAllPrices(['AVGO']);
    const w = statements.filter((s) => /INSERT INTO watchlist_quotes/i.test(s.sql));
    expect(w).toHaveLength(1);
    expect(w[0].sql).toMatch(/short_name/);
    expect(w[0].sql).toMatch(/short_name = COALESCE\(EXCLUDED\.short_name, watchlist_quotes\.short_name\)/);
    expect(w[0].params).toHaveLength(13);
    expect(w[0].params).toEqual(expect.arrayContaining(['AVGO', 'Broadcom Inc.', 495, 289.96, 1234]));
    // The chart path adds no reads of its own. The only watchlist_quotes read is the single
    // fundamentals-gate PK read (cold isolate, symbol never fetched) - see the fundamentals describe.
    const reads = statements.filter((s) => /^\s*SELECT/i.test(s.sql) && /watchlist_quotes/i.test(s.sql));
    expect(reads).toHaveLength(1);
    expect(reads[0].sql).toMatch(/SELECT symbol, short_name, fundamentals_updated_at FROM watchlist_quotes WHERE symbol IN/);
  });

  it('chunks watchlist rows so no statement exceeds 100 bound params', async () => {
    watchlistSymbols = Array.from({ length: 10 }, (_, i) => `S${i}`);
    for (const s of watchlistSymbols) marks.set(s, { price: 1, day_pct: 0, session: 'regular' });
    await refreshAllPrices(watchlistSymbols);
    const w = statements.filter((s) => /INSERT INTO watchlist_quotes/i.test(s.sql));
    expect(w.length).toBeGreaterThan(1);
    for (const st of w) expect(st.params.length).toBeLessThanOrEqual(100);
    expect(w.reduce((n, st) => n + st.params.length / 13, 0)).toBe(10);
  });
});

// ---------------------------------------------------------------------------------------------
// Fundamentals (market cap) gate: <= once per symbol per 24h, provider chain, per-provider back-off.
// ---------------------------------------------------------------------------------------------
describe('fundamentals refresh (market cap / shares / name)', () => {
  const NOW = Date.parse('2026-10-31T10:00:00Z');
  let urls: string[];
  let nasdaqStatus = 200;
  let quoteStatus = 200;
  let quoteAttempts = 0;
  let failFirstWith401 = false;
  let chartExtra: Record<string, unknown> = {};
  let v7Result: (symbol: string) => Record<string, unknown> = (symbol) => ({
    symbol,
    quoteType: 'EQUITY',
    marketCap: 1.5e12,
    sharesOutstanding: 4.7e9,
    regularMarketPrice: 320,
  });

  function v7(symbols: string[]) {
    return new Response(JSON.stringify({ quoteResponse: { result: symbols.map(v7Result) } }), { status: 200 });
  }

  beforeEach(() => {
    __resetQuoteServiceStateForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    marks.clear();
    wq.clear();
    statements.length = 0;
    urls = [];
    nasdaqStatus = 200;
    quoteStatus = 200;
    quoteAttempts = 0;
    failFirstWith401 = false;
    chartExtra = {};
    watchlistSymbols = ['AVGO', 'MU'];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.startsWith('https://api.nasdaq.com/')) {
          if (nasdaqStatus !== 200) return new Response('slow down', { status: nasdaqStatus });
          return new Response(JSON.stringify({ data: { summaryData: { MarketCap: { value: '$1,500,000,000,000' } } } }), { status: 200 });
        }
        if (url.includes('sec.gov')) return new Response('no', { status: 429 });
        if (url.startsWith('https://fc.yahoo.com')) {
          return new Response('', { status: 404, headers: { 'set-cookie': 'A3=d=abc; Domain=.yahoo.com; Path=/' } });
        }
        if (url.includes('getcrumb')) return new Response('crumb123', { status: 200 });
        if (url.includes('/v7/finance/quote')) {
          quoteAttempts++;
          if (failFirstWith401 && quoteAttempts === 1) return new Response('Unauthorized', { status: 401 });
          if (quoteStatus !== 200) return new Response('slow down', { status: quoteStatus });
          return v7(new URL(url).searchParams.get('symbols')!.split(','));
        }
        return yahooOk(321, { shortName: 'Chart Name', ...chartExtra });
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    watchlistSymbols = [];
  });

  const nasdaqCalls = () => urls.filter((u) => u.startsWith('https://api.nasdaq.com/'));
  const v7Calls = () => urls.filter((u) => u.includes('/v7/finance/quote'));
  const providerCalls = () => [...nasdaqCalls(), ...v7Calls()];
  const fundUpserts = () => statements.filter((s) => /INSERT INTO watchlist_quotes[\s\S]*cap_price = CASE/i.test(s.sql));
  const wqReads = () => statements.filter((s) => /^\s*SELECT/i.test(s.sql) && /watchlist_quotes/i.test(s.sql));
  const nameUpdates = () => statements.filter((s) => /^\s*UPDATE watchlist_quotes SET short_name/i.test(s.sql));

  it('first refresh: Nasdaq answers per symbol (no Yahoo v7), ONE batched upsert with cap, price-at-fetch and chart name', async () => {
    await refreshAllPrices(['AVGO', 'MU']);
    expect(nasdaqCalls()).toHaveLength(2);
    expect(v7Calls()).toHaveLength(0);
    const ups = fundUpserts();
    expect(ups).toHaveLength(1);
    const ts = new Date(NOW).toISOString();
    expect(ups[0].params).toEqual(['AVGO', 1.5e12, null, 321, 'Chart Name', ts, 'MU', 1.5e12, null, 321, 'Chart Name', ts]);
    expect(ups[0].sql).toMatch(/market_cap = COALESCE\(EXCLUDED\.market_cap, watchlist_quotes\.market_cap\)/);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[Fundamentals] provider=nasdaq ok=2/2'));
  });

  it('staleness gate: fresh (<24h) symbols cost no provider call and no write; a warm isolate does not even read', async () => {
    const fresh = new Date(NOW - 3_600_000).toISOString();
    wq.set('AVGO', { short_name: 'Broadcom Inc.', fundamentals_updated_at: fresh });
    wq.set('MU', { short_name: 'Micron', fundamentals_updated_at: fresh });
    await refreshAllPrices(['AVGO', 'MU']);
    expect(providerCalls()).toHaveLength(0);
    expect(fundUpserts()).toHaveLength(0);
    expect(wqReads()).toHaveLength(1);
    await refreshAllPrices(['AVGO', 'MU']);
    expect(wqReads()).toHaveLength(1);
    expect(providerCalls()).toHaveLength(0);
  });

  it('only the stale symbol is refetched once its 24h lapse', async () => {
    wq.set('AVGO', { short_name: 'Broadcom Inc.', fundamentals_updated_at: new Date(NOW - 3_600_000).toISOString() });
    wq.set('MU', { short_name: 'Micron', fundamentals_updated_at: new Date(NOW - 25 * 3_600_000).toISOString() });
    await refreshAllPrices(['AVGO', 'MU']);
    expect(nasdaqCalls()).toHaveLength(1);
    expect(nasdaqCalls()[0]).toContain('/MU/');
  });

  it('does not run again in the same isolate once written', async () => {
    await refreshAllPrices(['AVGO', 'MU']);
    await refreshAllPrices(['AVGO', 'MU']);
    expect(nasdaqCalls()).toHaveLength(2);
    expect(fundUpserts()).toHaveLength(1);
  });

  it('ignores non-watchlist symbols (positions/research)', async () => {
    await refreshAllPrices(['AVGO', 'MU', 'ZZZ']);
    expect(nasdaqCalls().every((u) => !u.includes('/ZZZ/'))).toBe(true);
    expect(nasdaqCalls()).toHaveLength(2);
  });

  it('Nasdaq 429 -> Yahoo v7 supplies ONE batched call for the symbols; Nasdaq is not hammered', async () => {
    nasdaqStatus = 429;
    await refreshAllPrices(['AVGO', 'MU']);
    expect(nasdaqCalls()).toHaveLength(2); // one wave, then the provider is backed off
    expect(v7Calls()).toHaveLength(1);
    expect(new URL(v7Calls()[0]).searchParams.get('symbols')).toBe('AVGO,MU');
    expect(new URL(v7Calls()[0]).searchParams.get('crumb')).toBe('crumb123');
    const ups = fundUpserts();
    expect(ups).toHaveLength(1);
    expect(ups[0].params.slice(0, 6)).toEqual(['AVGO', 1.5e12, 4.7e9, 320, 'Chart Name', new Date(NOW).toISOString()]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('provider=yahoo ok=2/2'));
  });

  it('Yahoo 401 refreshes the crumb once and retries', async () => {
    nasdaqStatus = 429;
    failFirstWith401 = true;
    await refreshAllPrices(['AVGO']);
    expect(v7Calls()).toHaveLength(2);
    expect(urls.filter((u) => u.includes('getcrumb'))).toHaveLength(2);
    expect(fundUpserts()).toHaveLength(1);
  });

  it('EVERY provider 429: names are STILL filled from the chart, no cap write, no hammering, then recovers', async () => {
    nasdaqStatus = 429;
    quoteStatus = 429;
    wq.set('AVGO', { short_name: null, fundamentals_updated_at: null });
    wq.set('MU', { short_name: null, fundamentals_updated_at: null });
    const res = await refreshAllPrices(['AVGO', 'MU']);
    expect(res.ok).toBe(true);
    expect(fundUpserts()).toHaveLength(0);
    // the prod bug: with Yahoo backed off the name backfill never ran and every row showed "-"
    expect(nameUpdates()).toHaveLength(1);
    expect(nameUpdates()[0].params).toEqual(['AVGO', 'Chart Name', 'MU', 'Chart Name', 'AVGO', 'MU']);
    const attempts = providerCalls().length;
    await refreshAllPrices(['AVGO', 'MU']);
    expect(providerCalls()).toHaveLength(attempts); // back-off active everywhere: no second attempt
    expect(wqReads()).toHaveLength(1); // ...and no extra reads either
    nasdaqStatus = 200;
    quoteStatus = 200;
    vi.setSystemTime(NOW + 31 * 60_000);
    await refreshAllPrices(['AVGO', 'MU']);
    expect(fundUpserts()).toHaveLength(1);
  });

  it('missing names on fresh rows are filled from the chart quote (one UPDATE, no provider call)', async () => {
    const fresh = new Date(NOW - 3_600_000).toISOString();
    wq.set('AVGO', { short_name: null, fundamentals_updated_at: fresh });
    wq.set('MU', { short_name: 'Micron', fundamentals_updated_at: fresh });
    await refreshAllPrices(['AVGO', 'MU']);
    expect(providerCalls()).toHaveLength(0);
    expect(nameUpdates()).toHaveLength(1);
    expect(nameUpdates()[0].params).toEqual(['AVGO', 'Chart Name', 'AVGO']);
    expect(nameUpdates()[0].sql).toMatch(/short_name IS NULL/);
  });

  it('ETF: skips Nasdaq, takes Yahoo net assets; an ETF with none is stamped (shows "-") and not retried', async () => {
    chartExtra = { instrumentType: 'ETF' };
    watchlistSymbols = ['TSDD', 'SMCZ'];
    v7Result = (symbol) =>
      symbol === 'TSDD'
        ? { symbol, quoteType: 'ETF', netAssets: 2.5e7, regularMarketPrice: 9 }
        : { symbol, quoteType: 'ETF', regularMarketPrice: 6 };
    await refreshAllPrices(['TSDD', 'SMCZ']);
    expect(nasdaqCalls()).toHaveLength(0);
    expect(v7Calls()).toHaveLength(1);
    const ups = fundUpserts();
    expect(ups).toHaveLength(1);
    const rowOf = (sym: string) => {
      const p = ups[0].params;
      const at = p.findIndex((v, i) => v === sym && i % 6 === 0);
      return p.slice(at, at + 6);
    };
    expect(rowOf('TSDD')[1]).toBe(2.5e7);
    expect(rowOf('SMCZ')[1]).toBeNull(); // no cap: "-" in the UI
    expect(rowOf('SMCZ')[5]).toBe(new Date(NOW).toISOString()); // but stamped: not asked again for 24h
    await refreshAllPrices(['TSDD', 'SMCZ']);
    expect(v7Calls()).toHaveLength(1);
  });
});
