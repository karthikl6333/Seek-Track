import { describe, expect, it } from 'vitest';
import { fmtPct, fmtRatioPct } from './format';

describe('fmtPct', () => {
  it('formats percent units without auto-scaling (0.89 stays 0.89%, not 89%)', () => {
    // Regression: GOOG dayPct=0.8938 was rendered as "89.38%" by the old (0,1)*100 heuristic.
    expect(fmtPct(0.893815839113161)).toBe('0.89%');
    expect(fmtPct(0.5751418281680952)).toBe('0.58%');
    expect(fmtPct(1.1288777968020092)).toBe('1.13%');
    expect(fmtPct(-1.75)).toBe('-1.75%');
    expect(fmtPct(null)).toBe('—');
  });
});

describe('fmtRatioPct', () => {
  it('formats 0..1 ratios (win rate)', () => {
    expect(fmtRatioPct(0.52)).toBe('52.00%');
    expect(fmtRatioPct(1)).toBe('100.00%');
    expect(fmtRatioPct(0)).toBe('0.00%');
  });
});
