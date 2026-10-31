import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetQuoteServiceStateForTests,
  dayChangeBaseline,
  fetchQuotesBatch,
  isUsablePrice,
  NOT_FOUND_RETRY_WITH_MARK_MS,
  NOT_FOUND_SKIP_NO_MARK_MS,
  parseYahooChart,
  selectQuotesToPersist,
  type QuoteData,
  type YahooChartResponse,
  type YahooMeta,
} from './quote-service.js';

function meta(partial: Partial<YahooMeta> & Pick<YahooMeta, 'regularMarketPrice'>): YahooMeta {
  return {
    previousClose: 100,
    chartPreviousClose: 100,
    ...partial,
  };
}

function chart(
  symbol: string,
  m: YahooMeta,
  closes: Array<number | null> = [null, 105],
): YahooChartResponse {
  return {
    chart: {
      result: [
        {
          meta: { ...m, symbol },
          timestamp: closes.map((_, i) => 1_700_000_000 + i * 60),
          indicators: { quote: [{ close: closes, open: closes.map(() => 100), volume: closes.map(() => 1) }] },
        },
      ],
    },
  };
}

describe('isUsablePrice', () => {
  it('rejects null/0/NaN/negative', () => {
    expect(isUsablePrice(null)).toBe(false);
    expect(isUsablePrice(0)).toBe(false);
    expect(isUsablePrice(-1)).toBe(false);
    expect(isUsablePrice(Number.NaN)).toBe(false);
    expect(isUsablePrice(12.34)).toBe(true);
  });
});

describe('dayChangeBaseline (previous regular-session close)', () => {
  const regularStart = 1_791_466_200; // 09:30 ET Oct 8 2026
  const yesterdayCloseTime = regularStart - 60; // just before today's open

  it('uses regularMarketPrice during pre-market when Yahoo previousClose is two days back', () => {
    // Real GOOG shape on 2026-10-08 pre-market: previousClose=344.59 (Oct 6),
    // regularMarketPrice=347.37 (Oct 7 close). Day % must be vs 347.37.
    const m = meta({
      previousClose: 344.59,
      chartPreviousClose: 344.59,
      regularMarketPrice: 347.37,
      regularMarketTime: yesterdayCloseTime,
      currentTradingPeriod: {
        pre: { start: regularStart - 5.5 * 3600, end: regularStart },
        regular: { start: regularStart, end: regularStart + 6.5 * 3600 },
        post: { start: regularStart + 6.5 * 3600, end: regularStart + 10.5 * 3600 },
      },
    });
    expect(dayChangeBaseline(m)).toBe(347.37);
  });

  it('uses previousClose once today\'s regular session has started', () => {
    const m = meta({
      previousClose: 344.59,
      chartPreviousClose: 344.59,
      regularMarketPrice: 350.0, // live print during regular hours
      regularMarketTime: regularStart + 60,
      currentTradingPeriod: {
        regular: { start: regularStart, end: regularStart + 6.5 * 3600 },
      },
    });
    expect(dayChangeBaseline(m)).toBe(344.59);
  });

  it('falls back to previousClose when regularMarketPrice is missing', () => {
    const m: YahooMeta = {
      previousClose: 10,
      chartPreviousClose: 10,
      currentTradingPeriod: { regular: { start: regularStart, end: regularStart + 1 } },
      regularMarketTime: yesterdayCloseTime,
    };
    expect(dayChangeBaseline(m)).toBe(10);
  });
});

describe('parseYahooChart', () => {
  const regularStart = 1_791_466_200;
  const yesterdayCloseTime = regularStart - 60;

  it('computes day% vs previous regular close during pre-market (not vs two-days-ago close)', () => {
    const m = meta({
      previousClose: 344.59,
      chartPreviousClose: 344.59,
      regularMarketPrice: 347.37,
      regularMarketTime: yesterdayCloseTime,
      currentTradingPeriod: {
        pre: { start: regularStart - 5.5 * 3600, end: regularStart },
        regular: { start: regularStart, end: regularStart + 6.5 * 3600 },
      },
    });
    // last bar 348.48 → (348.48 - 347.37) / 347.37 * 100 ≈ 0.3195%
    // The old code measured against 344.59 → ~1.13%, and fmtPct's (0,1)*100 bug then showed ~113%.
    const q = parseYahooChart('GOOG', chart('GOOG', m, [null, 348.48]), regularStart - 3600); // 08:30 ET
    expect(q.price).toBe(348.48);
    expect(q.session).toBe('premarket');
    expect(q.dayPct).toBeCloseTo(((348.48 - 347.37) / 347.37) * 100, 4);
    // Must stay in percent units (0.32, not 0.0032) — never a fraction that fmtPct would blow up.
    expect(Math.abs(q.dayPct!)).toBeLessThan(5);
    expect(Math.abs(q.dayPct!)).toBeGreaterThan(0.01);
  });

  it('prefers the last 1m close over regularMarketPrice', () => {
    const m = meta({
      regularMarketPrice: 100,
      previousClose: 99,
      currentTradingPeriod: {
        regular: { start: 1, end: 9_999_999_999 },
      },
    });
    const q = parseYahooChart('X', chart('X', m, [101, null, 102.5]), 100);
    expect(q.price).toBe(102.5);
  });

  it('throws when no usable price exists', () => {
    const m: YahooMeta = { previousClose: undefined, regularMarketPrice: undefined };
    expect(() => parseYahooChart('Z', chart('Z', m, [null, null]))).toThrow(/No price/);
  });
});

describe('selectQuotesToPersist (never blank)', () => {
  const q = (symbol: string, price: number, dayPct: number | null = 1): QuoteData => ({
    symbol,
    price,
    dayPct,
    source: 'yahoo',
    updatedAt: '2026-10-08T12:00:00.000Z',
    session: 'premarket',
    bid: null,
    ask: null,
    volume: null,
    marketCap: null,
    week52High: null,
    week52Low: null,
    valChange: null,
    sessionOpen: null,
  });

  it('never writes a null / 0 / NaN quote over an existing mark', () => {
    const quotes = new Map<string, QuoteData | null>([
      ['AMDU', null],
      ['AMDS', q('AMDS', 0)],
      ['GOOG', q('GOOG', Number.NaN)],
      ['AVGO', q('AVGO', 370.5, -1.4)],
    ]);
    const existing = new Map([
      ['AMDU', { price: 25.133, day_pct: -6.57, session: null }],
      ['AMDS', { price: 13.12, day_pct: 0.153, session: null }],
      ['GOOG', { price: 347.0, day_pct: 0.5, session: 'premarket' }],
      ['AVGO', { price: 370.0, day_pct: -1.5, session: 'premarket' }],
    ]);
    const changed = selectQuotesToPersist(quotes, existing);
    expect(changed.has('AMDU')).toBe(false);
    expect(changed.has('AMDS')).toBe(false);
    expect(changed.has('GOOG')).toBe(false);
    expect(changed.get('AVGO')?.price).toBe(370.5);
  });

  it('skips unchanged rows to save D1 writes', () => {
    const quotes = new Map([['NVDA', q('NVDA', 235.05, -1.75)]]);
    const existing = new Map([['NVDA', { price: 235.05, day_pct: -1.75, session: 'premarket' }]]);
    expect(selectQuotesToPersist(quotes, existing).size).toBe(0);
  });
});

describe('fetchQuotesBatch 404 back-off', () => {
  beforeEach(() => {
    __resetQuoteServiceStateForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    __resetQuoteServiceStateForTests();
  });

  function fetch404(url: string): Promise<Response> {
    const status = /AMDU|AMDS|SKHYV/.test(url) ? 404 : 200;
    if (status === 404) return Promise.resolve(new Response('Not Found', { status: 404 }));
    return Promise.resolve(
      new Response(
        JSON.stringify(
          chart('OK', meta({ regularMarketPrice: 10, previousClose: 10, currentTradingPeriod: { regular: { start: 1, end: 9e9 } } }), [10]),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  }

  it('uses the short 10m back-off when the symbol already has a mark', async () => {
    const now = () => Date.now();
    const withMark = new Set(['AMDU']);
    const first = await fetchQuotesBatch(['AMDU'], { symbolsWithMark: withMark, fetchImpl: fetch404 as typeof fetch, now });
    expect(first.get('AMDU')).toBeNull();

    // Still inside the 10m window → skipped, no second fetch
    const fetchSpy = vi.fn(fetch404);
    vi.advanceTimersByTime(NOT_FOUND_RETRY_WITH_MARK_MS - 1_000);
    await fetchQuotesBatch(['AMDU'], { symbolsWithMark: withMark, fetchImpl: fetchSpy as unknown as typeof fetch, now });
    expect(fetchSpy).not.toHaveBeenCalled();

    // After 10m → retried
    vi.advanceTimersByTime(2_000);
    await fetchQuotesBatch(['AMDU'], { symbolsWithMark: withMark, fetchImpl: fetchSpy as unknown as typeof fetch, now });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the long 6h back-off only when the symbol has no mark', async () => {
    const now = () => Date.now();
    await fetchQuotesBatch(['SKHYV'], { symbolsWithMark: new Set(), fetchImpl: fetch404 as typeof fetch, now });

    const fetchSpy = vi.fn(fetch404);
    vi.advanceTimersByTime(NOT_FOUND_RETRY_WITH_MARK_MS + 60_000); // past 10m, still inside 6h
    await fetchQuotesBatch(['SKHYV'], { symbolsWithMark: new Set(), fetchImpl: fetchSpy as unknown as typeof fetch, now });
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(NOT_FOUND_SKIP_NO_MARK_MS);
    await fetchQuotesBatch(['SKHYV'], { symbolsWithMark: new Set(), fetchImpl: fetchSpy as unknown as typeof fetch, now });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
