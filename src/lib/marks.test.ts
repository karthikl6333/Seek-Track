import { describe, expect, it } from 'vitest';
import { flattenMarks, mergeMarkDetails, mergeWatchlistRows, staleAge } from './marks';
import type { MarkInfo } from '../types';

const m = (symbol: string, price: number, updatedAt: string, dayPct = 1): MarkInfo => ({
  symbol,
  price,
  updatedAt,
  source: 'yahoo',
  dayPct,
  session: 'premarket',
});

describe('mergeMarkDetails (never blank)', () => {
  const prev = {
    NVDA: m('NVDA', 235, '2026-10-08T12:00:00.000Z'),
    GOOG: m('GOOG', 348, '2026-10-08T12:00:00.000Z', 0.89),
  };

  it('keeps known prices when the incoming payload is empty (stale/old client wipe)', () => {
    expect(mergeMarkDetails(prev, {})).toBe(prev);
    expect(mergeMarkDetails(prev, null)).toBe(prev);
  });

  it('merges a partial delta without dropping other symbols', () => {
    const next = mergeMarkDetails(prev, {
      GOOG: m('GOOG', 349, '2026-10-08T12:01:00.000Z', 0.5),
    });
    expect(next.NVDA.price).toBe(235);
    expect(next.GOOG.price).toBe(349);
  });

  it('ignores incoming entries with null/0/NaN prices', () => {
    const next = mergeMarkDetails(prev, {
      GOOG: { ...m('GOOG', 0, '2026-10-08T12:05:00.000Z'), price: 0 },
      AMD: { symbol: 'AMD', price: Number.NaN, updatedAt: '2026-10-08T12:05:00.000Z', source: 'yahoo' },
    });
    expect(next).toBe(prev);
  });

  it('ignores an older incoming update (stale snapshot)', () => {
    const next = mergeMarkDetails(prev, {
      GOOG: m('GOOG', 999, '2026-10-08T11:00:00.000Z'),
    });
    expect(next).toBe(prev);
  });

  it('flattenMarks drops unusable prices', () => {
    expect(flattenMarks({ A: m('A', 1, 't'), B: { ...m('B', 0, 't'), price: 0 } })).toEqual({ A: 1 });
  });
});

describe('mergeWatchlistRows', () => {
  const row = (symbol: string, last: number | null) => ({
    symbol,
    last,
    pctChange: last == null ? null : 1,
    valChange: null,
    bid: null,
    ask: null,
    marketCap: null,
    volume: null,
    week52High: null,
    week52Low: null,
    updatedAt: last == null ? null : '2026-10-08T12:00:00.000Z',
  });

  it('keeps the last known price when a refresh returns last=null', () => {
    const prev = [row('AMDU', 25.133), row('NVDA', 235)];
    const next = mergeWatchlistRows(prev, [row('AMDU', null), row('NVDA', 236), row('NEW', 10)]);
    expect(next.find((r) => r.symbol === 'AMDU')?.last).toBe(25.133);
    expect(next.find((r) => r.symbol === 'NVDA')?.last).toBe(236);
    expect(next.find((r) => r.symbol === 'NEW')?.last).toBe(10);
  });
});

describe('staleAge', () => {
  const now = Date.parse('2026-10-08T12:00:00.000Z');
  it('returns null when fresh', () => {
    expect(staleAge('2026-10-08T11:30:00.000Z', now)).toBeNull();
  });
  it('renders hours / days', () => {
    expect(staleAge('2026-10-08T09:00:00.000Z', now)).toBe('3h');
    expect(staleAge('2026-09-09T02:49:44.072Z', now)).toBe('29d');
  });
});
