import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RangeBar } from '../components/RangeBar';
import {
  dayChangeAmount,
  fmtMarketCap,
  fmtPrice,
  fmtSigned,
  fmtVolume,
  rangePosition,
  sortWatchlistRows,
  type WatchlistRowData,
} from './watchlist';

describe('fmtMarketCap', () => {
  it('formats 1.23T / 45.6B / 789M (3 significant figures)', () => {
    expect(fmtMarketCap(1.234e12)).toBe('1.23T');
    expect(fmtMarketCap(4.56e10)).toBe('45.6B');
    expect(fmtMarketCap(7.89e8)).toBe('789M');
  });
  it('keeps 3 significant figures across magnitudes', () => {
    expect(fmtMarketCap(1.5e12)).toBe('1.50T');
    expect(fmtMarketCap(1.23e13)).toBe('12.3T');
    expect(fmtMarketCap(2.5e9)).toBe('2.50B');
    expect(fmtMarketCap(1.234e11)).toBe('123B');
    expect(fmtMarketCap(5.5e6)).toBe('5.50M');
    expect(fmtMarketCap(12_340_000)).toBe('12.3M');
  });
  it('promotes the unit when rounding hits 1000', () => {
    expect(fmtMarketCap(9.996e11)).toBe('1.00T');
    expect(fmtMarketCap(9.996e8)).toBe('1.00B');
    expect(fmtMarketCap(1.5e14)).toBe('150T');
    expect(fmtMarketCap(4.05e12)).toBe('4.05T');
    expect(fmtMarketCap(999_999)).toBe('999,999');
  });
  it('dash when unknown / invalid', () => {
    for (const v of [null, undefined, NaN, 0, -5]) expect(fmtMarketCap(v as number)).toBe('—');
  });
});

describe('fmtVolume / fmtSigned / fmtPrice', () => {
  it('volume', () => {
    expect(fmtVolume(36_412_033)).toBe('36.4M');
    expect(fmtVolume(812_345)).toBe('812K');
    expect(fmtVolume(1_230_000_000)).toBe('1.23B');
    expect(fmtVolume(950)).toBe('950');
    expect(fmtVolume(null)).toBe('—');
  });
  it('signed change has explicit sign and no -0.00', () => {
    expect(fmtSigned(1.234)).toBe('+1.23');
    expect(fmtSigned(-1.234)).toBe('-1.23');
    expect(fmtSigned(-0.001)).toBe('0.00');
    expect(fmtSigned(-5.484, 2, '%')).toBe('-5.48%');
    expect(fmtSigned(null)).toBe('—');
  });
  it('price', () => {
    expect(fmtPrice(1234.5)).toBe('1,234.50');
    expect(fmtPrice(undefined)).toBe('—');
  });
});

describe('rangePosition', () => {
  it('maps last within [low, high] to 0..1', () => {
    expect(rangePosition(150, 100, 200)).toBe(0.5);
    expect(rangePosition(100, 100, 200)).toBe(0);
    expect(rangePosition(200, 100, 200)).toBe(1);
  });
  it('clamps a price outside a stale range', () => {
    expect(rangePosition(250, 100, 200)).toBe(1);
    expect(rangePosition(50, 100, 200)).toBe(0);
  });
  it('null when any input missing or the range is degenerate', () => {
    expect(rangePosition(null, 1, 2)).toBeNull();
    expect(rangePosition(1, null, 2)).toBeNull();
    expect(rangePosition(1, 1, undefined)).toBeNull();
    expect(rangePosition(5, 5, 5)).toBeNull();
  });
});

describe('RangeBar', () => {
  it('places the dot at the position and labels it', () => {
    const html = renderToStaticMarkup(createElement(RangeBar, { last: 150, low: 100, high: 200 }));
    expect(html).toContain('left:50.0%');
    expect(html).toContain('50% of 52-week range');
  });
  it('renders an empty track (no dot) when the range is unknown', () => {
    const html = renderToStaticMarkup(createElement(RangeBar, { last: 150, low: null, high: 200 }));
    expect(html).not.toContain('range-bar-dot');
    expect(html).toContain('52-week range unavailable');
  });
});

describe('sortWatchlistRows', () => {
  const r = (symbol: string, o: Partial<WatchlistRowData> = {}): WatchlistRowData => ({
    symbol, name: null, last: null, pctChange: null, valChange: null, marketCap: null, volume: null,
    week52High: null, week52Low: null, ...o,
  });
  const rows = [
    r('B', { last: 10, pctChange: -2, marketCap: 5e9, week52Low: 5, week52High: 20 }),
    r('A', { last: 30, pctChange: 3, marketCap: 1e12, week52Low: 10, week52High: 40 }),
    r('C', { last: null }),
    r('D', { last: 20, pctChange: 1, marketCap: null, week52Low: 10, week52High: 20 }),
  ];
  const syms = (k: Parameters<typeof sortWatchlistRows>[1], d: 1 | -1) => sortWatchlistRows(rows, k, d).map((x) => x.symbol);

  it('sorts by symbol', () => {
    expect(syms('symbol', 1)).toEqual(['A', 'B', 'C', 'D']);
    expect(syms('symbol', -1)).toEqual(['D', 'C', 'B', 'A']);
  });
  it('sorts numerically and keeps unknowns last in BOTH directions', () => {
    expect(syms('last', -1)).toEqual(['A', 'D', 'B', 'C']);
    expect(syms('last', 1)).toEqual(['B', 'D', 'A', 'C']);
    expect(syms('marketCap', -1)).toEqual(['A', 'B', 'C', 'D']);
    expect(syms('marketCap', 1)).toEqual(['B', 'A', 'C', 'D']);
  });
  it('sorts by position in the 52-week range', () => {
    // A: (30-10)/30=.67  B: (10-5)/15=.33  D: 1.0  C: unknown
    expect(syms('range', -1)).toEqual(['D', 'A', 'B', 'C']);
    expect(syms('range', 1)).toEqual(['B', 'A', 'D', 'C']);
  });
  it('does not mutate its input', () => {
    const before = rows.map((x) => x.symbol);
    sortWatchlistRows(rows, 'last', 1);
    expect(rows.map((x) => x.symbol)).toEqual(before);
  });
});

describe('dayChangeAmount', () => {
  it('is on the same basis as the day % (vs previous close), not the session open', () => {
    // last 110 after +10% => previous close 100 => +$10, even if the stored (session-open) change says otherwise
    expect(dayChangeAmount(110, 10, -3)).toBeCloseTo(10, 6);
    expect(dayChangeAmount(95, -5, 4)).toBeCloseTo(-5, 6);
  });
  it('falls back to the stored value without a usable %', () => {
    expect(dayChangeAmount(100, null, 1.5)).toBe(1.5);
    expect(dayChangeAmount(null, 2, 1.5)).toBe(1.5);
    expect(dayChangeAmount(100, -100, null)).toBeNull();
  });
});
