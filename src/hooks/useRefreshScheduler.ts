import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import {
  autoRefreshAllowedAt,
  autoRefreshPlan,
  marketSessionAt,
  nonTradingWindowAt,
  type NonTradingWindow,
} from '../lib/marketHours';
import { refreshSucceeded } from '../lib/refreshStamp';
import { createTtlValue } from '../lib/pollGate';
import { getQuoteUniverse, loadWatchlistSymbols } from '../api/client';
import type { WatchlistRef } from '../pages/overview/Watchlist';
import type { ResearchRef } from '../pages/research/Research';
import type { Store } from './useStore';
import { usePaperSync } from './usePaperSync';

const CHUNK_SIZE = 10; // Max symbols per HTTP request (CF Workers limit)
/** How often we re-evaluate the session-aware interval (handles open/close transitions). */
const INTERVAL_RECHECK_MS = 60_000;

/** Watchlist symbols when the Watchlist component isn't mounted (one GET per 5 min at most). */
const watchlistSymbolsMemo = createTtlValue(5 * 60_000, () => loadWatchlistSymbols());

export interface RefreshDeps {
  storeRef: MutableRefObject<Store>;
  watchlistRef: RefObject<WatchlistRef>;
  researchRef: RefObject<ResearchRef>;
}

/**
 * Price refresh orchestration: initial refresh, session-aware auto-refresh schedule
 * (30s / 60s / 10m / paused on weekends and NYSE holidays), tab-visibility refresh, and the
 * manual refresh action. Callbacks read storeRef.current so they (and the effects) stay stable.
 */
export function useRefreshScheduler({ storeRef, watchlistRef, researchRef }: RefreshDeps) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshComplete, setRefreshComplete] = useState(false);
  const autoRefreshingRef = useRef(false);
  const autoRefreshingHoldingsRef = useRef(false);
  const { maybeSyncPaper, resetPaperSync } = usePaperSync(storeRef);

  // Weekend / NYSE holiday window (last trading day 20:00 ET → next trading day 04:00 ET):
  // no automatic Yahoo refresh, no SSE polling. Updated by the scheduler when the session flips.
  const [closedWindow, setClosedWindow] = useState<NonTradingWindow | null>(() => nonTradingWindowAt(new Date()));

  /**
   * Refresh holdings + watchlist only (30s cadence)
   * Used by: 30s interval (both live and delayed modes), visibilitychange handler
   * 
   * Uses storeRef.current to read current store state without depending on store identity
   * This keeps the callback stable (deps: []) so intervals don't reset on every marks update
   */
  const refreshHoldingsAndWatchlist = useCallback(async () => {
    if (autoRefreshingHoldingsRef.current) return;
    autoRefreshingHoldingsRef.current = true;
    
    try {
      // Read from storeRef.current (not store) to avoid recreating callback on marks updates
      const currentStore = storeRef.current;
      
      // Get holdings symbols (open positions)
      const holdingsSymbols = (currentStore.analysis?.positions.filter((p) => p.quantity !== 0).map((p) => p.symbol) ?? [])
        .map((s) => s.toUpperCase().trim())
        .filter((s) => s.length > 0 && s !== 'TEST');
      
      // Get watchlist symbols from API (fresh data)
      // Use shared helper that correctly parses {symbols, rows, lastRefreshAt} response
      // Prefer the symbols the mounted Watchlist already has (no extra GET /api/watchlist).
      let watchlistSymbols: string[] = watchlistRef.current?.getSymbols() ?? [];
      try {
        if (!watchlistRef.current) watchlistSymbols = await watchlistSymbolsMemo.get();
      } catch (e) {
        console.warn('[App] Failed to fetch watchlist for refresh:', e);
      }
      
      const symbols = [...new Set([...holdingsSymbols, ...watchlistSymbols])];
      
      if (symbols.length === 0) {
        console.log('[App] No holdings/watchlist symbols to refresh');
        autoRefreshingHoldingsRef.current = false;
        return;
      }
      
      console.log(`[App] Refreshing ${symbols.length} holdings/watchlist symbols in chunks of ${CHUNK_SIZE}`);
      
      // Refresh in chunks (each HTTP request = fresh 50-subrequest budget)
      // Continue on failure (don't abort remaining chunks)
      let anyChunkOk = false;
      for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
        const chunk = symbols.slice(i, i + CHUNK_SIZE);
        try {
          const res = await currentStore.refreshLiveQuotes(chunk, { includeHoldings: false });
          if (refreshSucceeded(res)) anyChunkOk = true;
          console.log(
            `[App] Holdings/watchlist chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(symbols.length / CHUNK_SIZE)} complete`
          );
        } catch (chunkError) {
          console.error(`[App] Holdings/watchlist chunk ${Math.floor(i / CHUNK_SIZE) + 1} failed:`, chunkError);
          // Continue to next chunk
        }
      }
      
      // Re-read marks and UI state. A successful check moves the watchlist "Last refreshed"
      // stamp even when the server found no changes (and wrote nothing).
      const watchlistCheckedAt = anyChunkOk && watchlistSymbols.length > 0 ? new Date().toISOString() : null;
      // Marks only (delta via ?since=): trades/settings/journal/pairs are NOT re-read every cycle.
      await Promise.allSettled([
        currentStore.refreshMarks(),
        watchlistRef.current?.reload({ checkedAt: watchlistCheckedAt }),
        maybeSyncPaper(),
      ]);
    } catch (error) {
      console.error('[App] Holdings/watchlist refresh error:', error);
    } finally {
      autoRefreshingHoldingsRef.current = false;
    }
  }, []); // Empty deps: callback is stable, reads storeRef.current at call time

  /**
   * Refresh full universe (all symbols including Research)
   * Used by: mount effect (once), 15-min interval
   * 
   * Uses storeRef.current to read current store state without depending on store identity
   * This keeps the callback stable (deps: []) so intervals don't reset on every marks update
   */
  const refreshAll = useCallback(async (opts?: { full?: boolean }) => {
    if (autoRefreshingRef.current) return;
    autoRefreshingRef.current = true;
    
    try {
      // Read from storeRef.current (not store) to avoid recreating callback on marks updates
      const currentStore = storeRef.current;
      
      // Get full symbol universe (1 HTTP request, 1 Neon query)
      const { symbols: universe } = await getQuoteUniverse();
      console.log(`[App] Refreshing full universe: ${universe.length} symbols in chunks of ${CHUNK_SIZE}`);
      
      // Refresh in chunks (each HTTP request = fresh 50-subrequest budget)
      // Continue on failure (don't abort remaining chunks)
      let anyChunkOk = false;
      for (let i = 0; i < universe.length; i += CHUNK_SIZE) {
        const chunk = universe.slice(i, i + CHUNK_SIZE);
        try {
          const res = await currentStore.refreshLiveQuotes(chunk, { includeHoldings: false });
          if (refreshSucceeded(res)) anyChunkOk = true;
          console.log(
            `[App] Full universe chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(universe.length / CHUNK_SIZE)} complete`
          );
        } catch (chunkError) {
          console.error(`[App] Full universe chunk ${Math.floor(i / CHUNK_SIZE) + 1} failed:`, chunkError);
          // Continue to next chunk
        }
      }
      
      // Re-read all client state from shared store (universe includes the watchlist symbols)
      // Manual refresh (full) re-reads everything incl. trades; the 15-min auto cycle only marks.
      if (opts?.full) {
        resetPaperSync(); // manual: sync the on-screen paper books now
        watchlistSymbolsMemo.invalidate();
      }
      await Promise.allSettled([
        opts?.full ? currentStore.refresh({ fresh: true }) : currentStore.refreshMarks(),
        watchlistRef.current?.reload({ checkedAt: anyChunkOk ? new Date().toISOString() : null }),
        researchRef.current?.reload(),
        maybeSyncPaper(),
      ]);
    } catch (error) {
      console.error('[App] Full universe refresh error:', error);
    } finally {
      autoRefreshingRef.current = false;
    }
  }, []); // Empty deps: callback is stable, reads storeRef.current at call time

  /**
   * Manual refresh button (with animation)
   * Stable because refreshAll is stable (empty deps)
   */
  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshComplete(false);
    try {
      await refreshAll({ full: true });
      setRefreshComplete(true);
      setTimeout(() => setRefreshComplete(false), 1500);
    } catch (error) {
      console.error('Manual refresh error:', error);
    } finally {
      setRefreshing(false);
    }
  }, [refreshAll]); // refreshAll is stable (deps: []), so this is also stable

  /**
   * Initial refresh on mount (always runs, regardless of live quotes setting)
   * This ensures we fetch current prices when the page loads, even if the marks
   * table has stale data from hours ago.
   * 
   * CRITICAL: Empty deps ([]) ensures this runs EXACTLY ONCE on mount.
   * refreshAll is stable (empty deps, reads storeRef.current at call time).
   * Without empty deps, this would re-run on every marks update (every ~3s in live mode).
   */
  useEffect(() => {
    const initialTimer = setTimeout(() => {
      if (!autoRefreshAllowedAt(new Date())) {
        // Weekend/holiday: show stored marks only (useStore already did one GET /api/marks on load).
        console.log('[App] Weekend/holiday: skipping initial Yahoo refresh, showing stored prices');
        return;
      }
      console.log('[App] Running initial refresh on mount');
      void refreshAll();
    }, 1000); // 1s delay for initial load

    return () => clearTimeout(initialTimer);
  }, []); // Empty deps: run exactly once on mount, even when store identity changes

  /**
   * Auto-refresh system (session-aware, America/New_York):
   * - Regular hours: holdings/watchlist every 30s, full universe every 15m
   * - Pre-market / after-hours: holdings/watchlist every 60s, full universe every 15m
   * - Weekday overnight (closed): holdings/watchlist every 10m, full universe every 60m
   * - Weekend / NYSE holiday window (last trading day 20:00 ET → next trading day 04:00 ET):
   *   NO automatic refresh; a wake timer (plus the 60s session re-check) resumes refreshing at
   *   04:00 ET on the next trading day
   * - Pauses while the tab is hidden; refreshes when it becomes visible (weekdays only)
   * - Manual refresh buttons always work, including on weekends/holidays
   *
   * CRITICAL: Empty deps ([]) so intervals are not reset on every marks update.
   * Callbacks are stable (empty deps, read storeRef.current).
   */
  useEffect(() => {
    let holdingsHandle: number | null = null;
    let fullHandle: number | null = null;
    let wakeHandle: number | null = null;
    let recheckHandle: number | null = null;
    let currentSession = marketSessionAt(new Date());

    const clearTimers = () => {
      if (holdingsHandle !== null) { clearInterval(holdingsHandle); holdingsHandle = null; }
      if (fullHandle !== null) { clearInterval(fullHandle); fullHandle = null; }
      if (wakeHandle !== null) { clearTimeout(wakeHandle); wakeHandle = null; }
    };

    const schedule = () => {
      const plan = autoRefreshPlan(new Date());
      currentSession = plan.session;
      setClosedWindow(plan.window);
      const { holdingsMs, fullMs } = plan;
      clearTimers();

      if (holdingsMs === null || fullMs === null) {
        const wakeIn = plan.resumeInMs;
        console.log(
          `[App] Auto-refresh paused (session=${currentSession})` +
            (wakeIn !== null && plan.window
              ? `; ${plan.window.kind}, resumes in ${Math.round(wakeIn / 60000)}m (${plan.window.resumesAt.toISOString()})`
              : ''),
        );
        // setTimeout delays are capped at 2^31-1 ms (~24.8 days); a weekend/holiday window is ≤ 4 days.
        if (wakeIn !== null) wakeHandle = window.setTimeout(checkSession, wakeIn + 1_000);
        return;
      }

      console.log(
        `[App] Auto-refresh: session=${currentSession}, holdings/watchlist=${holdingsMs / 1000}s, full=${fullMs / 60000}m`,
      );
      holdingsHandle = window.setInterval(() => {
        if (document.hidden || !autoRefreshAllowedAt(new Date())) return;
        void refreshHoldingsAndWatchlist();
      }, holdingsMs);
      fullHandle = window.setInterval(() => {
        if (document.hidden || !autoRefreshAllowedAt(new Date())) return;
        console.log('[App] Running full universe refresh');
        void refreshAll();
      }, fullMs);
    };

    /** Re-evaluate the session; when a weekend/holiday window ends, resume and refresh right away. */
    function checkSession() {
      const prev = currentSession;
      const next = marketSessionAt(new Date());
      if (next === prev) return;
      schedule();
      if (prev === 'nontrading' && next !== 'nontrading' && !document.hidden) {
        console.log('[App] Weekend/holiday over, resuming automatic refresh');
        void refreshHoldingsAndWatchlist();
      }
    }

    schedule();
    // Safety net for session flips (9:30 open, 16:00 close, laptop sleep across Mon 04:00, etc.)
    recheckHandle = window.setInterval(checkSession, INTERVAL_RECHECK_MS);

    const handleVisibilityChange = () => {
      if (document.hidden) return;
      checkSession(); // may resume after a weekend/holiday spent hidden
      if (!autoRefreshAllowedAt(new Date())) return; // weekend/holiday: no Yahoo refresh on visible
      if (!autoRefreshingHoldingsRef.current) {
        console.log('[App] Tab visible, triggering holdings/watchlist refresh');
        void refreshHoldingsAndWatchlist();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimers();
      if (recheckHandle !== null) clearInterval(recheckHandle);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []); // Empty deps: intervals persist across store identity changes

  return { closedWindow, refreshing, refreshComplete, handleManualRefresh };
}
