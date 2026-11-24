import { useCallback, useState } from 'react';
import {
  CALC_COUNT_STORAGE_KEY,
  parseCalculatorCount,
} from '../lib/calculators';

/** How many Overview what-if calculators to show (1–9, default 3). Persisted in localStorage. */
export function useCalculatorCount() {
  const [count, setCountState] = useState(() => {
    try {
      return parseCalculatorCount(localStorage.getItem(CALC_COUNT_STORAGE_KEY));
    } catch {
      return parseCalculatorCount(null);
    }
  });

  const setCount = useCallback((next: number) => {
    const n = parseCalculatorCount(next);
    setCountState(n);
    try {
      localStorage.setItem(CALC_COUNT_STORAGE_KEY, String(n));
    } catch {
      // ignore quota / private-mode failures
    }
  }, []);

  return { count, setCount };
}
