import { describe, expect, it } from 'vitest';
import {
  autoSeasonFor,
  calendarSeason,
  parseSeasonPref,
  resolveSeasonTheme,
  seasonCssVars,
  SEASON_THEMES,
  type SeasonId,
} from './seasons';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

describe('calendarSeason', () => {
  it('maps months to seasons', () => {
    const expected: SeasonId[] = [
      'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
      'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
    ];
    expected.forEach((s, i) => expect(calendarSeason(i + 1)).toBe(s));
  });
});

describe('autoSeasonFor', () => {
  it('uses the calendar season on ordinary days', () => {
    expect(autoSeasonFor(at(2026, 1, 15))).toBe('winter');
    expect(autoSeasonFor(at(2026, 4, 15))).toBe('spring');
    expect(autoSeasonFor(at(2026, 7, 15))).toBe('summer');
    expect(autoSeasonFor(at(2026, 9, 15))).toBe('autumn');
    expect(autoSeasonFor(at(2026, 11, 20))).toBe('autumn');
    expect(autoSeasonFor(at(2026, 12, 10))).toBe('winter');
  });

  it('Halloween window is Oct 24 – Nov 1', () => {
    expect(autoSeasonFor(at(2026, 10, 23))).toBe('autumn');
    expect(autoSeasonFor(at(2026, 10, 24))).toBe('halloween');
    expect(autoSeasonFor(at(2026, 10, 31))).toBe('halloween');
    expect(autoSeasonFor(at(2026, 11, 1))).toBe('halloween');
    expect(autoSeasonFor(at(2026, 11, 2))).toBe('autumn');
  });

  it('Diwali 2026 is Nov 8 (±2 days) and follows the table for 2027–2030', () => {
    expect(autoSeasonFor(at(2026, 11, 5))).toBe('autumn');
    expect(autoSeasonFor(at(2026, 11, 6))).toBe('diwali');
    expect(autoSeasonFor(at(2026, 11, 8))).toBe('diwali');
    expect(autoSeasonFor(at(2026, 11, 10))).toBe('diwali');
    expect(autoSeasonFor(at(2026, 11, 11))).toBe('autumn');
    expect(autoSeasonFor(at(2027, 10, 29))).toBe('diwali');
    expect(autoSeasonFor(at(2028, 10, 17))).toBe('diwali');
    expect(autoSeasonFor(at(2029, 11, 5))).toBe('diwali');
    expect(autoSeasonFor(at(2030, 10, 26))).toBe('diwali');
  });

  it('Diwali wins over Halloween when they overlap (2027)', () => {
    expect(autoSeasonFor(at(2027, 10, 27))).toBe('diwali');
    expect(autoSeasonFor(at(2027, 10, 25))).toBe('halloween');
  });

  it('Christmas / New Year runs Dec 20 – Jan 2, across the year boundary', () => {
    expect(autoSeasonFor(at(2026, 12, 19))).toBe('winter');
    expect(autoSeasonFor(at(2026, 12, 20))).toBe('christmas');
    expect(autoSeasonFor(at(2026, 12, 31))).toBe('christmas');
    expect(autoSeasonFor(at(2027, 1, 2))).toBe('christmas');
    expect(autoSeasonFor(at(2027, 1, 3))).toBe('winter');
  });

  it('Holi uses the table (Holika Dahan to the day after)', () => {
    expect(autoSeasonFor(at(2026, 3, 2))).toBe('spring');
    expect(autoSeasonFor(at(2026, 3, 3))).toBe('holi');
    expect(autoSeasonFor(at(2026, 3, 4))).toBe('holi');
    expect(autoSeasonFor(at(2026, 3, 5))).toBe('holi');
    expect(autoSeasonFor(at(2026, 3, 6))).toBe('spring');
    expect(autoSeasonFor(at(2027, 3, 23))).toBe('holi');
    // Holi 2029 is Mar 1: the Dahan day Feb 28 is still February
    expect(autoSeasonFor(at(2029, 2, 28))).toBe('holi');
  });

  it('falls back to calendar seasons for years outside the festival tables', () => {
    expect(autoSeasonFor(at(2040, 11, 8))).toBe('autumn');
    expect(autoSeasonFor(at(2040, 10, 31))).toBe('halloween');
  });
});

describe('resolveSeasonTheme / pref handling', () => {
  it('off disables, a specific id forces it, auto follows the date', () => {
    const d = at(2026, 10, 31);
    expect(resolveSeasonTheme('off', d)).toBeNull();
    expect(resolveSeasonTheme('winter', d)?.id).toBe('winter');
    expect(resolveSeasonTheme('auto', d)?.id).toBe('halloween');
  });

  it('parseSeasonPref accepts valid values and defaults to auto', () => {
    expect(parseSeasonPref('off')).toBe('off');
    expect(parseSeasonPref('diwali')).toBe('diwali');
    expect(parseSeasonPref('bogus')).toBe('auto');
    expect(parseSeasonPref(null)).toBe('auto');
    expect(parseSeasonPref('constructor')).toBe('auto');
  });

  it('themes never define P&L colors', () => {
    for (const t of Object.values(SEASON_THEMES)) {
      const vars = Object.keys(seasonCssVars(t));
      expect(vars.some((v) => /gain|loss|danger/.test(v))).toBe(false);
    }
  });
});
