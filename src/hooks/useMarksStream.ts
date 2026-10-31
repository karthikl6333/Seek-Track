import { useCallback, useEffect, useMemo, type MutableRefObject, type RefObject } from 'react';
import { useLiveQuotes } from './useLiveQuotes';
import type { Store } from './useStore';
import { createThrottle } from '../lib/pollGate';
import type { WatchlistRef } from '../pages/overview/Watchlist';
import type { ResearchRef } from '../pages/research/Research';

/** SSE deltas re-read the watchlist/research views at most this often (server caches ~20s too). */
const VIEW_RELOAD_MIN_MS = 20_000;

/** Live marks stream (SSE with polling fallback) wired into the store and the on-screen views. */
export function useMarksStream({
  enabled,
  storeRef,
  watchlistRef,
  researchRef,
}: {
  enabled: boolean;
  storeRef: MutableRefObject<Store>;
  watchlistRef: RefObject<WatchlistRef>;
  researchRef: RefObject<ResearchRef>;
}) {
  // Live quotes SSE connection
  // Stable callback (empty deps) reads storeRef.current at call time
  // SSE deltas: re-read the watchlist/research views at most every VIEW_RELOAD_MIN_MS.
  const viewReloadThrottle = useMemo(
    () =>
      createThrottle(VIEW_RELOAD_MIN_MS, () => {
        void Promise.allSettled([watchlistRef.current?.reload(), researchRef.current?.reload()]);
      }),
    [],
  );
  useEffect(() => () => viewReloadThrottle.cancel(), [viewReloadThrottle]);

  const { connected: liveConnected } = useLiveQuotes(
    enabled, // prices don't move on weekends/holidays: skip the 5s D1 marks poll
    useCallback((data) => {
      // Update store with live marks (read from storeRef.current for stable callback)
      storeRef.current.applyMarksUpdate(data);

      // Empty delta: nothing to reload (saves D1 reads). Full snapshots and non-empty deltas
      // re-read the watchlist/research displays so they pick up the new marks join.
      if (Object.keys(data.marks).length === 0) return;
      viewReloadThrottle.call();
    }, [viewReloadThrottle]) // stable: stable callback, reads storeRef.current at call time
  );

  return { liveConnected };
}
