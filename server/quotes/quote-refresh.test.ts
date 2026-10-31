import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the D1 adapter: records every statement and serves the marks table.
const marks = new Map<string, { price: number; day_pct: number | null; session: string | null }>();
const statements: Array<{ sql: string; params: unknown[] }> = [];
let watchlistSymbols: string[] = [];

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
    // The only reads are the pre-existing ones (marks lookup, symbol sets); nothing touches watchlist_quotes.
    const reads = statements.filter((s) => /^\s*SELECT/i.test(s.sql));
    expect(reads.some((r) => /watchlist_quotes/i.test(r.sql))).toBe(false);
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
