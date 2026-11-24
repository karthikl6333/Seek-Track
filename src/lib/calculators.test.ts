import { describe, expect, it } from 'vitest';
import {
  CALC_SLOTS,
  DEFAULT_CALCULATOR_COUNT,
  MAX_CALCULATORS,
  MIN_CALCULATORS,
  parseCalculatorCount,
  visibleCalcSlots,
} from './calculators';

describe('parseCalculatorCount', () => {
  it('defaults to 3 for missing, empty, or invalid values', () => {
    expect(DEFAULT_CALCULATOR_COUNT).toBe(3);
    expect(parseCalculatorCount(null)).toBe(3);
    expect(parseCalculatorCount(undefined)).toBe(3);
    expect(parseCalculatorCount('')).toBe(3);
    expect(parseCalculatorCount('foo')).toBe(3);
    expect(parseCalculatorCount(1.5)).toBe(3);
    expect(parseCalculatorCount('0')).toBe(3);
    expect(parseCalculatorCount(0)).toBe(3);
    expect(parseCalculatorCount(10)).toBe(3);
    expect(parseCalculatorCount('9.0')).toBe(9);
  });

  it('accepts integers from 1 to 9', () => {
    for (let n = MIN_CALCULATORS; n <= MAX_CALCULATORS; n++) {
      expect(parseCalculatorCount(n)).toBe(n);
      expect(parseCalculatorCount(String(n))).toBe(n);
    }
  });
});

describe('visibleCalcSlots', () => {
  it('returns the first N labels, defaulting invalid counts to 3', () => {
    expect(visibleCalcSlots(1)).toEqual(['A']);
    expect(visibleCalcSlots(3)).toEqual(['A', 'B', 'C']);
    expect(visibleCalcSlots(4)).toEqual(['A', 'B', 'C', 'D']);
    expect(visibleCalcSlots(6)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(visibleCalcSlots(9)).toEqual([...CALC_SLOTS]);
    expect(visibleCalcSlots(99)).toEqual(['A', 'B', 'C']);
  });
});
