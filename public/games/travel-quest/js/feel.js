/**
 * Juice that does not touch the hit boxes: combo timing, squash, and the
 * souvenir magnet. The hurdle test still owns jump height.
 */

export const COMBO_WINDOW = 1.6;

/** Next combo step. A gap longer than the window starts again at 1. */
export function bumpCombo(combo, sinceLast) {
  if (combo > 0 && sinceLast <= COMBO_WINDOW) return combo + 1;
  return 1;
}

/**
 * Stretch on the way up, squash on landing. `land` is 1 at the impact frame
 * and eases to 0. Returned scales are unitless around the feet.
 */
export function squashStretch({ pose, vy, ph, land }) {
  const safePh = ph || 1;
  if (land > 0) {
    const k = Math.max(0, Math.min(1, land));
    return { sx: 1 + 0.18 * k, sy: 1 - 0.16 * k };
  }
  if (pose === 'jump') {
    const stretch = Math.max(-1, Math.min(1, vy / (safePh * 4)));
    return { sx: 1 - stretch * 0.08, sy: 1 + stretch * 0.12 };
  }
  if (pose === 'duck') return { sx: 1.04, sy: 0.98 };
  return { sx: 1, sy: 1 };
}

/** Pull a souvenir toward the runner. Far items stay put. */
export function magnetPull(dx, dy, radius) {
  const dist = Math.hypot(dx, dy);
  if (!(radius > 0) || dist >= radius || dist < 0.001) return { x: 0, y: 0, pop: 1 };
  const t = (1 - dist / radius) ** 1.35;
  return { x: dx * t * 0.72, y: dy * t * 0.72, pop: 1 + t * 0.28 };
}
