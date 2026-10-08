import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the D1 adapter: records every statement and serves the marks table.
const marks = new Map<string, { price: number; day_pct: number | null; session: string | null }>();
const statements: Array<{ sql: string; params: unknown[] }> = [];

vi.mock('./db.js', () => ({
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

function yahooOk(price: number) {
  return new Response(
    JSON.stringify({
      chart: {
        result: [
          {
            meta: {
              regularMarketPrice: price,
              previousClose: price,
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
