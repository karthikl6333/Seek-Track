import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }));

const { dayChangeAmount, toWatchlistRow } = await import('./watchlist.js');

const base = {
  symbol: 'mu',
  bid: null,
  ask: null,
  market_cap: null,
  volume: null,
  week52_high: null,
  week52_low: null,
  updated_at: '2026-10-31T10:00:00.000Z',
};

describe('dayChangeAmount (server)', () => {
  it('derives the amount from last and pct so the sign always matches', () => {
    expect(dayChangeAmount(110, 10, -3)).toBeCloseTo(10, 6);
    expect(dayChangeAmount(95, -5, 4)).toBeCloseTo(-5, 6);
  });
  it('falls back to the stored amount only without a usable pct / price', () => {
    expect(dayChangeAmount(100, null, 1.5)).toBe(1.5);
    expect(dayChangeAmount(null, 2, 1.5)).toBe(1.5);
    expect(dayChangeAmount(100, -100, null)).toBeNull();
  });
});

describe('toWatchlistRow: valChange and pctChange never disagree in sign', () => {
  it('overrides a stale stored val_change (session-open delta) that contradicts pct_change', () => {
    // The prod rows: stored val_change -4.2 (price below today's open) next to pct_change +3.1% (above yesterday's close).
    const up = toWatchlistRow({ ...base, last: 103.1, pct_change: 3.1, val_change: -4.2 });
    expect(up.pctChange).toBe(3.1);
    expect(up.valChange).toBeCloseTo(3.1, 6);
    const down = toWatchlistRow({ ...base, last: 95, pct_change: -5, val_change: 7 });
    expect(down.valChange).toBeCloseTo(-5, 6);
    for (const r of [up, down]) expect(Math.sign(r.valChange!)).toBe(Math.sign(r.pctChange!));
  });
  it('uses the stored amount when there is no pct', () => {
    expect(toWatchlistRow({ ...base, last: 10, pct_change: null, val_change: 0.4 }).valChange).toBe(0.4);
  });
});
