import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flashDirection, type FlashDirection } from '../lib/priceFlash';

/**
 * Wraps a rendered price and pulses it green/red for a moment when `value` ticks.
 * Purely presentational: it only watches the number it is given (no extra fetching), never flashes
 * on the first value, and the animation is disabled under prefers-reduced-motion (see App.css).
 */
export function PriceFlash({ value, children }: { value: number | null | undefined; children: ReactNode }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<{ dir: FlashDirection; n: number } | null>(null);

  useEffect(() => {
    const dir = flashDirection(prev.current, value);
    prev.current = value;
    if (!dir) return;
    setFlash((f) => ({ dir, n: (f?.n ?? 0) + 1 }));
    const id = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(id);
  }, [value]);

  return (
    <span key={flash?.n ?? 0} className={flash ? `price-flash flash-${flash.dir}` : undefined}>
      {children}
    </span>
  );
}
