import { describe, expect, it } from 'vitest';
import {
  autoRefreshAllowedAt,
  autoRefreshPlan,
  fullUniverseRefreshIntervalMs,
  holdingsRefreshIntervalMs,
  marketSessionAt,
  msUntilWeekendEnds,
  nyClock,
} from './marketHours';

/**
 * The UTC instant at which America/New_York wall clock reads `y-m-d hh:mm`.
 * Resolved with Intl (no hard-coded -4/-5 offset), so DST weeks are exercised for real.
 */
function ny(y: number, m: number, d: number, hh: number, mm: number): Date {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const wanted = Date.UTC(y, m - 1, d, hh, mm);
  // Try every plausible offset (UTC-3..UTC-6) and keep the one whose NY rendering matches.
  for (const offH of [4, 5, 3, 6]) {
    const cand = new Date(wanted + offH * 3_600_000);
    const p = Object.fromEntries(fmt.formatToParts(cand).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    if (asUtc === wanted) return cand;
  }
  throw new Error(`no NY instant for ${y}-${m}-${d} ${hh}:${mm}`);
}

// Week of Oct 5–12 2026 (EDT). 2026-10-09 is a Friday.
const FRI = [2026, 10, 9] as const;
const SAT = [2026, 10, 10] as const;
const SUN = [2026, 10, 11] as const;
const MON = [2026, 10, 12] as const;

describe('weekend boundaries (Fri 20:00 ET → Mon 04:00 ET)', () => {
  it('Fri 19:59 ET refreshes (after-hours)', () => {
    const t = ny(...FRI, 19, 59);
    expect(marketSessionAt(t)).toBe('afterhours');
    expect(autoRefreshAllowedAt(t)).toBe(true);
    expect(holdingsRefreshIntervalMs(t)).toBe(60_000);
  });

  it('Fri 20:00 and 20:01 ET do not refresh', () => {
    for (const mm of [0, 1]) {
      const t = ny(...FRI, 20, mm);
      expect(marketSessionAt(t)).toBe('weekend');
      expect(autoRefreshAllowedAt(t)).toBe(false);
      expect(holdingsRefreshIntervalMs(t)).toBeNull();
      expect(fullUniverseRefreshIntervalMs(t)).toBeNull();
    }
  });

  it('Saturday and Sunday (any hour) do not refresh', () => {
    for (const day of [SAT, SUN]) {
      for (const hh of [0, 4, 10, 16, 23]) {
        const t = ny(...day, hh, 30);
        expect(marketSessionAt(t)).toBe('weekend');
        expect(autoRefreshAllowedAt(t)).toBe(false);
      }
    }
  });

  it('Mon 03:59 ET does not refresh; Mon 04:00 ET refreshes (pre-market)', () => {
    const before = ny(...MON, 3, 59);
    expect(marketSessionAt(before)).toBe('weekend');
    expect(autoRefreshAllowedAt(before)).toBe(false);

    const open = ny(...MON, 4, 0);
    expect(marketSessionAt(open)).toBe('premarket');
    expect(autoRefreshAllowedAt(open)).toBe(true);
    expect(holdingsRefreshIntervalMs(open)).toBe(60_000);
  });

  it('weekday overnight keeps the 10 min refresh (Tue 02:00, Thu 22:00, Mon 20:30)', () => {
    for (const t of [ny(2026, 10, 13, 2, 0), ny(2026, 10, 15, 22, 0), ny(...MON, 20, 30)]) {
      expect(marketSessionAt(t)).toBe('closed');
      expect(holdingsRefreshIntervalMs(t)).toBe(10 * 60_000);
      expect(fullUniverseRefreshIntervalMs(t)).toBe(60 * 60_000);
    }
  });
});

describe('weekend wake-up (Mon 04:00 ET), DST-aware', () => {
  it('msUntilWeekendEnds lands exactly on Mon 04:00 ET', () => {
    const sat = ny(...SAT, 12, 0);
    const ms = msUntilWeekendEnds(sat)!;
    expect(new Date(sat.getTime() + ms).getTime()).toBe(ny(...MON, 4, 0).getTime());
    expect(msUntilWeekendEnds(ny(...MON, 4, 0))).toBeNull();
  });

  it('handles the fall-back weekend (DST ends Sun 2026-11-01): Fri 21:00 EDT → Mon 04:00 EST', () => {
    const fri = ny(2026, 10, 30, 21, 0);
    const monOpen = ny(2026, 11, 2, 4, 0);
    expect(marketSessionAt(fri)).toBe('weekend');
    expect(fri.getTime() + msUntilWeekendEnds(fri)!).toBe(monOpen.getTime());
    // 55h of wall clock + 1h gained when clocks fall back = 56h real time
    expect(msUntilWeekendEnds(fri)).toBe(56 * 3_600_000);
    expect(nyClock(monOpen)).toEqual({ dow: 1, minutes: 240 });
    expect(marketSessionAt(ny(2026, 11, 2, 3, 59))).toBe('weekend');
    expect(marketSessionAt(monOpen)).toBe('premarket');
  });

  it('handles the spring-forward weekend (DST starts Sun 2026-03-08)', () => {
    const fri = ny(2026, 3, 6, 21, 0);
    const monOpen = ny(2026, 3, 9, 4, 0);
    expect(msUntilWeekendEnds(fri)).toBe(54 * 3_600_000); // 55h wall clock − 1h lost
    expect(fri.getTime() + msUntilWeekendEnds(fri)!).toBe(monOpen.getTime());
    expect(marketSessionAt(ny(2026, 3, 6, 19, 59))).toBe('afterhours');
    expect(marketSessionAt(ny(2026, 3, 6, 20, 1))).toBe('weekend');
  });
});

describe('autoRefreshPlan', () => {
  it('weekday regular: 30s / 15m, no resume timer', () => {
    expect(autoRefreshPlan(ny(2026, 10, 8, 10, 0))).toEqual({
      session: 'regular',
      holdingsMs: 30_000,
      fullMs: 15 * 60_000,
      resumeInMs: null,
    });
  });

  it('weekend: nothing scheduled, resume timer set for Mon 04:00 ET', () => {
    const sun = ny(...SUN, 23, 0);
    const plan = autoRefreshPlan(sun);
    expect(plan.session).toBe('weekend');
    expect(plan.holdingsMs).toBeNull();
    expect(plan.fullMs).toBeNull();
    expect(plan.resumeInMs).toBe(5 * 3_600_000);
  });

  it('weekday sessions keep existing cadence', () => {
    expect(holdingsRefreshIntervalMs(ny(2026, 10, 8, 8, 0))).toBe(60_000);
    expect(holdingsRefreshIntervalMs(ny(2026, 10, 8, 17, 0))).toBe(60_000);
    expect(fullUniverseRefreshIntervalMs(ny(2026, 10, 8, 10, 0))).toBe(15 * 60_000);
  });
});
