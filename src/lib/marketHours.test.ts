import { describe, expect, it } from 'vitest';
import {
  autoRefreshAllowedAt,
  autoRefreshPlan,
  civilKey,
  easterSunday,
  fullUniverseRefreshIntervalMs,
  holdingsRefreshIntervalMs,
  marketSessionAt,
  msUntilTradingResumes,
  nonTradingBadge,
  nonTradingPricesLabel,
  nonTradingTooltip,
  nonTradingWindowAt,
  nyClock,
  nyseHolidays,
  nyWallTimeToDate,
} from './marketHours';

/** Instant at which America/New_York reads y-m-d hh:mm (Intl-resolved, no fixed offset). */
const ny = (y: number, m: number, d: number, hh: number, mm: number) => nyWallTimeToDate({ y, m, d }, hh, mm);
const keys = (y: number) => nyseHolidays(y).map((h) => civilKey(h.date));
const H = 3_600_000;

/** Asserts auto-refresh state at a NY wall time. */
function expectRefresh(y: number, m: number, d: number, hh: number, mm: number, allowed: boolean) {
  const t = ny(y, m, d, hh, mm);
  expect(autoRefreshAllowedAt(t), `${y}-${m}-${d} ${hh}:${mm} ET`).toBe(allowed);
  expect(holdingsRefreshIntervalMs(t) === null).toBe(!allowed);
  expect(fullUniverseRefreshIntervalMs(t) === null).toBe(!allowed);
}

describe('ny helper sanity (independent of process TZ)', () => {
  it('round-trips wall clock across both DST offsets', () => {
    expect(nyClock(ny(2026, 1, 15, 4, 0))).toMatchObject({ date: { y: 2026, m: 1, d: 15 }, minutes: 240 });
    expect(ny(2026, 1, 15, 4, 0).toISOString()).toBe('2026-01-15T09:00:00.000Z'); // EST
    expect(ny(2026, 7, 15, 4, 0).toISOString()).toBe('2026-07-15T08:00:00.000Z'); // EDT
  });
});

describe('NYSE holiday calendar (by rule)', () => {
  it('2026 matches the NYSE published calendar', () => {
    expect(keys(2026)).toEqual([
      '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
      '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
    ]);
  });

  it('2027 matches the NYSE published calendar (Juneteenth/Christmas observed Fri, July 4 observed Mon)', () => {
    expect(keys(2027)).toEqual([
      '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
      '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
    ]);
  });

  it('2028: Saturday Jan 1 is NOT observed (no Fri Dec 31 2027 closure)', () => {
    expect(keys(2028)).toEqual([
      '2028-01-17', '2028-02-21', '2028-04-14', '2028-05-29', '2028-06-19',
      '2028-07-04', '2028-09-04', '2028-11-23', '2028-12-25',
    ]);
    expect(keys(2027)).not.toContain('2027-12-31');
    expect(autoRefreshAllowedAt(ny(2027, 12, 31, 10, 0))).toBe(true);
  });

  it('Sunday Jan 1 is observed Monday Jan 2 (2023), Sunday Christmas → Mon Dec 26 (2022)', () => {
    expect(keys(2023)).toContain('2023-01-02');
    expect(keys(2022)).toContain('2022-12-26');
    expect(keys(2021)).not.toContain('2021-06-18'); // Juneteenth only from 2022
    expect(keys(2022)).toContain('2022-06-20'); // Sun Jun 19 2022 → Mon
  });

  it('Easter computus', () => {
    expect(civilKey(easterSunday(2024))).toBe('2024-03-31');
    expect(civilKey(easterSunday(2026))).toBe('2026-04-05');
    expect(civilKey(easterSunday(2027))).toBe('2027-03-28');
    expect(civilKey(easterSunday(2038))).toBe('2038-04-25');
  });
});

describe('weekend boundaries (Fri 20:00 ET → Mon 04:00 ET)', () => {
  it('Fri 19:59 refreshes, Fri 20:01 / Sun / Mon 03:59 do not, Mon 04:00 refreshes', () => {
    expectRefresh(2026, 10, 9, 19, 59, true);
    expectRefresh(2026, 10, 9, 20, 0, false);
    expectRefresh(2026, 10, 9, 20, 1, false);
    expectRefresh(2026, 10, 10, 12, 0, false);
    expectRefresh(2026, 10, 11, 12, 0, false);
    expectRefresh(2026, 10, 12, 3, 59, false);
    expectRefresh(2026, 10, 12, 4, 0, true);
    expect(marketSessionAt(ny(2026, 10, 12, 4, 0))).toBe('premarket');
  });

  it('weekday overnight between trading days keeps 10m / 60m', () => {
    for (const t of [ny(2026, 10, 13, 2, 0), ny(2026, 10, 15, 22, 0)]) {
      expect(marketSessionAt(t)).toBe('closed');
      expect(holdingsRefreshIntervalMs(t)).toBe(10 * 60_000);
      expect(fullUniverseRefreshIntervalMs(t)).toBe(60 * 60_000);
    }
  });

  it('plain weekend window: badge Weekend, resumes Mon 04:00', () => {
    const w = nonTradingWindowAt(ny(2026, 10, 10, 12, 0))!;
    expect(w.kind).toBe('weekend');
    expect(nonTradingBadge(w)).toBe('Weekend');
    expect(nonTradingPricesLabel(w)).toBe('Weekend — prices as of Fri close');
    expect(w.resumesAt.getTime()).toBe(ny(2026, 10, 12, 4, 0).getTime());
  });
});

describe('holiday windows', () => {
  it('holiday Monday (MLK 2027-01-18): Fri 20:00 → Tue 04:00', () => {
    expectRefresh(2027, 1, 15, 19, 59, true);
    expectRefresh(2027, 1, 15, 20, 1, false);
    expectRefresh(2027, 1, 17, 12, 0, false);
    expectRefresh(2027, 1, 18, 4, 0, false); // would be pre-market on a normal Monday
    expectRefresh(2027, 1, 18, 12, 0, false);
    expectRefresh(2027, 1, 19, 3, 59, false);
    expectRefresh(2027, 1, 19, 4, 0, true);
    const w = nonTradingWindowAt(ny(2027, 1, 16, 9, 0))!;
    expect(w.kind).toBe('holiday');
    expect(nonTradingBadge(w)).toBe('Holiday');
    expect(nonTradingTooltip(w)).toBe(
      'Holiday (Martin Luther King, Jr. Day): automatic refresh paused until Tue Jan 19, 04:00 ET. Manual refresh still works.',
    );
    expect(nonTradingPricesLabel(w)).toBe('Holiday — prices as of Fri close');
    expect(civilKey(w.resumeDay)).toBe('2027-01-19');
  });

  it('Thanksgiving 2026 (Thu Nov 26): Wed 20:00 → Fri 04:00 (Fri early close = normal day)', () => {
    expectRefresh(2026, 11, 25, 19, 59, true);
    expectRefresh(2026, 11, 25, 20, 1, false);
    expectRefresh(2026, 11, 26, 12, 0, false);
    expectRefresh(2026, 11, 27, 3, 59, false);
    expectRefresh(2026, 11, 27, 4, 0, true);
    expectRefresh(2026, 11, 27, 20, 1, false); // then the normal weekend
    const w = nonTradingWindowAt(ny(2026, 11, 26, 12, 0))!;
    expect(w.holidays.map((h) => h.name)).toEqual(['Thanksgiving Day']);
    expect(nonTradingPricesLabel(w)).toBe('Holiday — prices as of Wed close');
    expect(msUntilTradingResumes(ny(2026, 11, 26, 12, 0))).toBe(16 * H);
  });

  it('Good Friday 2026 (Apr 3): Thu 20:00 → Mon 04:00', () => {
    expectRefresh(2026, 4, 2, 19, 59, true);
    expectRefresh(2026, 4, 2, 20, 1, false);
    expectRefresh(2026, 4, 3, 10, 0, false);
    expectRefresh(2026, 4, 5, 12, 0, false);
    expectRefresh(2026, 4, 6, 3, 59, false);
    expectRefresh(2026, 4, 6, 4, 0, true);
    const w = nonTradingWindowAt(ny(2026, 4, 4, 12, 0))!; // Saturday inside the holiday window
    expect(w.kind).toBe('holiday');
    expect(nonTradingTooltip(w)).toContain('Good Friday');
    expect(nonTradingTooltip(w)).toContain('Mon Apr 6, 04:00 ET');
    expect(civilKey(w.lastTradingDay)).toBe('2026-04-02');
    expect(msUntilTradingResumes(ny(2026, 4, 2, 20, 0))).toBe(80 * H);
  });

  it('Christmas 2027 observed Fri Dec 24: Thu 20:00 → Mon 04:00; New Year 2028 not observed', () => {
    expectRefresh(2027, 12, 23, 20, 1, false);
    expectRefresh(2027, 12, 27, 4, 0, true);
    expectRefresh(2027, 12, 31, 19, 59, true);
    expectRefresh(2028, 1, 3, 4, 0, true);
  });
});

describe('DST-safe wake-up', () => {
  it('fall-back weekend (DST ends Sun 2026-11-01): Fri 21:00 EDT → Mon 04:00 EST = 56h', () => {
    expect(msUntilTradingResumes(ny(2026, 10, 30, 21, 0))).toBe(56 * H);
    expectRefresh(2026, 11, 2, 3, 59, false);
    expectRefresh(2026, 11, 2, 4, 0, true);
  });

  it('spring-forward weekend (DST starts Sun 2026-03-08): Fri 21:00 EST → Mon 04:00 EDT = 54h', () => {
    expect(msUntilTradingResumes(ny(2026, 3, 6, 21, 0))).toBe(54 * H);
    expectRefresh(2026, 3, 6, 19, 59, true);
    expectRefresh(2026, 3, 6, 20, 1, false);
  });
});

describe('autoRefreshPlan', () => {
  it('trading day: intervals set, no window', () => {
    expect(autoRefreshPlan(ny(2026, 10, 8, 10, 0))).toEqual({
      session: 'regular',
      holdingsMs: 30_000,
      fullMs: 15 * 60_000,
      resumeInMs: null,
      window: null,
    });
    expect(holdingsRefreshIntervalMs(ny(2026, 10, 8, 8, 0))).toBe(60_000);
    expect(holdingsRefreshIntervalMs(ny(2026, 10, 8, 17, 0))).toBe(60_000);
  });

  it('holiday: nothing scheduled, wake at next trading day 04:00 ET', () => {
    const plan = autoRefreshPlan(ny(2026, 9, 7, 23, 0)); // Labor Day night
    expect(plan.session).toBe('nontrading');
    expect(plan.holdingsMs).toBeNull();
    expect(plan.fullMs).toBeNull();
    expect(plan.resumeInMs).toBe(5 * H);
    expect(plan.window?.kind).toBe('holiday');
  });
});
