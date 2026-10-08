import { describe, expect, it } from 'vitest';
import {
  fullUniverseRefreshIntervalMs,
  holdingsRefreshIntervalMs,
  marketSessionAt,
} from './marketHours';

/** Build a Date that is `hh:mm` America/New_York on a known weekday (2026-10-08 = Thursday). */
function et(hh: number, mm: number, dayOffset = 0): Date {
  // 2026-10-08 00:00 EDT = 2026-10-08 04:00 UTC
  const baseUtc = Date.UTC(2026, 9, 8 + dayOffset, 4, 0, 0);
  return new Date(baseUtc + (hh * 60 + mm) * 60_000);
}

describe('marketSessionAt', () => {
  it('classifies weekday sessions', () => {
    expect(marketSessionAt(et(3, 0))).toBe('closed');
    expect(marketSessionAt(et(4, 0))).toBe('premarket');
    expect(marketSessionAt(et(9, 29))).toBe('premarket');
    expect(marketSessionAt(et(9, 30))).toBe('regular');
    expect(marketSessionAt(et(15, 59))).toBe('regular');
    expect(marketSessionAt(et(16, 0))).toBe('afterhours');
    expect(marketSessionAt(et(19, 59))).toBe('afterhours');
    expect(marketSessionAt(et(20, 0))).toBe('closed');
  });
  it('treats weekends as closed', () => {
    expect(marketSessionAt(et(12, 0, 2))).toBe('closed'); // Saturday
  });
});

describe('session-aware intervals', () => {
  it('uses 30s / 60s / 10m for holdings', () => {
    expect(holdingsRefreshIntervalMs(et(10, 0))).toBe(30_000);
    expect(holdingsRefreshIntervalMs(et(8, 0))).toBe(60_000);
    expect(holdingsRefreshIntervalMs(et(17, 0))).toBe(60_000);
    expect(holdingsRefreshIntervalMs(et(22, 0))).toBe(10 * 60_000);
  });
  it('uses 15m / 60m for full universe', () => {
    expect(fullUniverseRefreshIntervalMs(et(10, 0))).toBe(15 * 60_000);
    expect(fullUniverseRefreshIntervalMs(et(22, 0))).toBe(60 * 60_000);
  });
});
