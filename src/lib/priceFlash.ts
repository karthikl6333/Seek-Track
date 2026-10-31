export type FlashDirection = 'up' | 'down';

/**
 * Direction of a price tick, or null when nothing should flash: the first value seen, a missing
 * value (never-blank prices keep the last known number), or an unchanged price.
 */
export function flashDirection(prev: number | null | undefined, next: number | null | undefined): FlashDirection | null {
  if (prev == null || next == null) return null;
  if (!Number.isFinite(prev) || !Number.isFinite(next) || prev === next) return null;
  return next > prev ? 'up' : 'down';
}
