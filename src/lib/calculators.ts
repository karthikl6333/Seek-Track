/** What-if calculator slots on Overview: A–I (up to 9), shown 3 per row. */
export const CALC_SLOTS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const;

export type CalcSlot = (typeof CALC_SLOTS)[number];

export const MIN_CALCULATORS = 1;
export const MAX_CALCULATORS = CALC_SLOTS.length;
export const DEFAULT_CALCULATOR_COUNT = 3;

export const CALC_COUNT_STORAGE_KEY = 'seektrack.calculatorCount';

/** Clamp a count to 1–9, or fall back to the default of 3 when the value is invalid. */
export function parseCalculatorCount(raw: string | number | null | undefined): number {
  const n = typeof raw === 'number' ? raw : raw == null || raw === '' ? Number.NaN : Number(raw);
  if (!Number.isInteger(n) || n < MIN_CALCULATORS || n > MAX_CALCULATORS) {
    return DEFAULT_CALCULATOR_COUNT;
  }
  return n;
}

export function visibleCalcSlots(count: number): CalcSlot[] {
  return CALC_SLOTS.slice(0, parseCalculatorCount(count));
}

export function mapCalcSlots<T>(factory: (slot: CalcSlot) => T): Record<CalcSlot, T> {
  return Object.fromEntries(CALC_SLOTS.map((slot) => [slot, factory(slot)])) as Record<CalcSlot, T>;
}
