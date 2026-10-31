import { describe, expect, it } from 'vitest';
import { fmtFactor, fmtTime, generalCharacteristics } from './format';
import { SECTOR_THEMES } from './sectorThemes';

describe('research format helpers', () => {
  it('fmtFactor signs positive leverage and handles missing values', () => {
    expect(fmtFactor(2)).toBe('+2x');
    expect(fmtFactor(-3)).toBe('-3x');
    expect(fmtFactor(null)).toBe('—');
    expect(fmtFactor(Number.NaN)).toBe('—');
  });

  it('fmtTime returns a dash for empty input', () => {
    expect(fmtTime(null)).toBe('—');
    expect(fmtTime(undefined)).toBe('—');
    expect(fmtTime('2026-01-02T03:04:05Z')).not.toBe('—');
  });

  it('generalCharacteristics varies by kind and mentions leverage factor', () => {
    expect(generalCharacteristics('underlying', null).cons).toContain('No leverage amplification');
    expect(generalCharacteristics('bear', -2).pros[0]).toMatch(/profit from daily declines/);
    expect(generalCharacteristics('bull', 3).pros[0]).toContain('3x');
    expect(generalCharacteristics('bull', null).pros[0]).toContain('leveraged');
  });

  it('SECTOR_THEMES entries are well-formed', () => {
    for (const [key, t] of Object.entries(SECTOR_THEMES)) {
      expect(t.name, key).toBeTruthy();
      for (const e of [...t.bull, ...t.bear]) expect(e.etf).toMatch(/^[A-Z]+$/);
    }
  });
});
