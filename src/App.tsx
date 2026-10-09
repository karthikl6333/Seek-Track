import './App.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Charges } from './components/Charges';
import { Charts } from './components/Charts';
import { Research } from './components/Research';
import { Overview } from './components/Overview';
import { Paper } from './components/Paper';
import { CryptoPaper } from './components/CryptoPaper';
import { PaperFlex } from './components/PaperFlex';
import { Positions } from './components/Positions';
import { Trades } from './components/Trades';
import { useStore } from './hooks/useStore';
import { useLiveQuotes } from './hooks/useLiveQuotes';
import {
  autoRefreshAllowedAt,
  autoRefreshPlan,
  marketSessionAt,
  nonTradingBadge,
  nonTradingTooltip,
  nonTradingWindowAt,
  type NonTradingWindow,
} from './lib/marketHours';
import { refreshSucceeded } from './lib/refreshStamp';
import { createThrottle, createTtlValue, PAPER_SYNCED_EVENT, paperSyncTargets, type PaperBook } from './lib/pollGate';
import type { ViewId } from './types';
import { getQuoteUniverse, refreshPaperData, refreshCryptoPaperLivePnl, refreshPaperFlexData, loadWatchlistSymbols } from './lib/db';
import type { WatchlistRef } from './components/Watchlist';
import type { ResearchRef } from './components/Research';

const NAV: { id: ViewId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'positions', label: 'Positions' },
  { id: 'trades', label: 'Trades' },
  { id: 'charges', label: 'Charges' },
  { id: 'charts', label: 'Charts' },
  { id: 'research', label: 'Research' },
  { id: 'paper', label: 'Paper' },
  { id: 'paperFlex', label: 'Paper Flex' },
  { id: 'cryptoPaper', label: 'Crypto Paper' },
];

const CHUNK_SIZE = 10; // Max symbols per HTTP request (CF Workers limit)
const LIVE_QUOTES_KEY = 'seektrack.liveQuotes';
/** How often we re-evaluate the session-aware interval (handles open/close transitions). */
const INTERVAL_RECHECK_MS = 60_000;
/** SSE deltas re-read the watchlist/research views at most this often (server caches ~20s too). */
const VIEW_RELOAD_MIN_MS = 20_000;

/** Watchlist symbols when the Watchlist component isn't mounted (one GET per 5 min at most). */
const watchlistSymbolsMemo = createTtlValue(5 * 60_000, () => loadWatchlistSymbols());

const PAPER_SYNC: Record<PaperBook, () => Promise<unknown>> = {
  paper: () => refreshPaperData(),
  cryptoPaper: () => refreshCryptoPaperLivePnl(),
  paperFlex: () => refreshPaperFlexData(),
};

export default function App() {
  const store = useStore();
  // Stable refs to avoid recreating callbacks/effects on every marks update
  // store object gets new identity when marks/markDetails/analysis change (every SSE tick in live mode)
  // Without refs: refreshAll/refreshHoldingsAndWatchlist recreate every ~3s → mount effect re-runs → continuous loop
  // With refs: callbacks read storeRef.current at call time → stable deps ([]) → effects run once
  const storeRef = useRef(store);
  storeRef.current = store; // Update ref on every render, but callbacks stay stable
  
  const watchlistRef = useRef<WatchlistRef>(null);
  const researchRef = useRef<ResearchRef>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshComplete, setRefreshComplete] = useState(false);
  const autoRefreshingRef = useRef(false);
  const autoRefreshingHoldingsRef = useRef(false);
  const lastPaperSyncRef = useRef<number | null>(null);

  /**
   * Background Alpaca sync for the paper books on screen only, at most every 5 min (was: all three
   * books on every 30s cycle, each followed by summary re-reads). Fires PAPER_SYNCED_EVENT so the
   * visible summary cards re-read once.
   */
  const maybeSyncPaper = useCallback(async () => {
    const targets = paperSyncTargets(storeRef.current.view, {
      hidden: document.hidden,
      nowMs: Date.now(),
      lastSyncMs: lastPaperSyncRef.current,
    });
    if (targets.length === 0) return;
    lastPaperSyncRef.current = Date.now();
    await Promise.allSettled(targets.map((t) => PAPER_SYNC[t]()));
    window.dispatchEvent(new CustomEvent(PAPER_SYNCED_EVENT, { detail: { books: targets } }));
  }, []);
  
  // Weekend / NYSE holiday window (last trading day 20:00 ET → next trading day 04:00 ET):
  // no automatic Yahoo refresh, no SSE polling. Updated by the scheduler when the session flips.
  const [closedWindow, setClosedWindow] = useState<NonTradingWindow | null>(() => nonTradingWindowAt(new Date()));

  // Live quotes toggle state
  const [liveQuotesEnabled, setLiveQuotesEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem(LIVE_QUOTES_KEY);
      return saved === null ? true : saved === 'true'; // Default ON
    } catch {
      return true;
    }
  });

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
        lastPaperSyncRef.current = null; // manual: sync the on-screen paper books now
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

  const toggleLiveQuotes = useCallback(() => {
    setLiveQuotesEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LIVE_QUOTES_KEY, String(next));
      } catch {
        // ignore
      }
      console.log(`[App] Live quotes ${next ? 'enabled' : 'disabled'}`);
      return next;
    });
  }, []);

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
    liveQuotesEnabled && !closedWindow, // prices don't move on weekends/holidays: skip the 5s D1 marks poll
    useCallback((data) => {
      // Update store with live marks (read from storeRef.current for stable callback)
      storeRef.current.applyMarksUpdate(data);

      // Empty delta: nothing to reload (saves D1 reads). Full snapshots and non-empty deltas
      // re-read the watchlist/research displays so they pick up the new marks join.
      if (Object.keys(data.marks).length === 0) return;
      viewReloadThrottle.call();
    }, [viewReloadThrottle]) // stable: stable callback, reads storeRef.current at call time
  );

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

  const handleLogout = useCallback(() => {
    // Robust Basic Auth logout for Chromium/Safari/Firefox
    // 
    // The challenge: Browsers aggressively cache Basic Auth credentials per origin
    // and modern browsers ignore/strip embedded user:pass@ in URLs for security.
    // 
    // Solution: Use XMLHttpRequest with bogus credentials, then navigate to logout endpoint
    // 1. Send XHR with explicit wrong credentials (logout:logout) to any auth-protected endpoint
    //    → This overwrites the browser's cached Basic Auth credentials
    // 2. Navigate to /api/logout endpoint
    //    → Server returns 401 + WWW-Authenticate header
    //    → Browser realizes cached (wrong) credentials failed
    //    → Browser prompts user for new valid credentials
    // 3. After successful login → full page reload with fresh data
    
    try {
      const xhr = new XMLHttpRequest();
      const protocol = window.location.protocol;
      const host = window.location.host;
      
      // Send synchronous XHR with bogus credentials to overwrite cache
      // Using /api/logout which will return 401
      xhr.open('GET', `${protocol}//${host}/api/logout`, false, 'logout', 'logout');
      try {
        xhr.send();
      } catch {
        // Expected to fail with 401 - that's what we want
      }
      
      // Now navigate to root - browser will use the wrong cached credentials
      // and get 401, prompting for new login
      window.location.href = '/';
    } catch (error) {
      console.error('Logout error:', error);
      // Fallback: just navigate to root and hope for the best
      window.location.href = '/';
    }
  }, []);

  if (!store.ready || !store.settings) {
    if (store.authError) {
      return (
        <div className="main" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <p className="muted">Session expired. Please log in again.</p>
          <button
            type="button"
            className="btn"
            onClick={() => window.location.reload()}
            style={{
              minWidth: 120,
              minHeight: 40,
              height: 40,
              paddingLeft: 16,
              paddingRight: 16,
              fontSize: 14,
            }}
          >
            Log In
          </button>
        </div>
      );
    }
    return (
      <div className="main">
        <p className="muted">Loading data…</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-row">
            <img src="/favicon.svg" alt="" className="brand-icon" width={22} height={22} />
            <h1>Seek&amp;Track</h1>
          </div>
          <p>Numbers-first trading ledger</p>
        </div>
        {NAV.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`nav-btn${store.view === n.id ? ' active' : ''}`}
            onClick={() => store.setView(n.id)}
          >
            {n.label}
          </button>
        ))}
      </aside>
      <main className="main">
        <div className="topbar">
          <h2>{NAV.find((n) => n.id === store.view)?.label}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Live/Delayed badge */}
            <div
              style={{
                padding: '4px 10px',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                background: liveQuotesEnabled && !closedWindow
                  ? (liveConnected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)')
                  : 'rgba(156, 163, 175, 0.15)',
                color: liveQuotesEnabled && !closedWindow
                  ? (liveConnected ? '#22c55e' : '#eab308')
                  : '#9ca3af',
                border: `1px solid ${liveQuotesEnabled && !closedWindow
                  ? (liveConnected ? '#22c55e' : '#eab308')
                  : '#9ca3af'}`,
              }}
              title={closedWindow
                ? nonTradingTooltip(closedWindow)
                : liveQuotesEnabled
                ? (liveConnected ? 'Live streaming active (~5s updates)' : 'Connecting to live stream...')
                : 'Session-aware delayed refresh'}
            >
              {closedWindow ? nonTradingBadge(closedWindow) : liveQuotesEnabled ? (liveConnected ? '● Live' : '○ Connecting') : 'Delayed'}
            </div>
            
            {/* Live quotes toggle */}
            <button
              type="button"
              className="btn"
              onClick={toggleLiveQuotes}
              title={liveQuotesEnabled ? 'Disable live quotes (session-aware poll)' : 'Enable live quotes (SSE)'}
              style={{
                minWidth: 70,
                minHeight: 40,
                height: 40,
                paddingLeft: 12,
                paddingRight: 12,
                fontSize: 13,
                background: liveQuotesEnabled ? 'var(--accent, #3d8bfd)' : undefined,
              }}
            >
              {liveQuotesEnabled ? 'Live On' : 'Live Off'}
            </button>
            
            {store.lastRefreshError && (
              <div
                style={{
                  fontSize: 12,
                  color: '#e67e22',
                  maxWidth: 280,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`${store.lastRefreshError} (last known prices still shown)`}
              >
                ⚠ {store.lastRefreshError.split('\n')[0].slice(0, 100)}
              </div>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => void handleLogout()}
              title="Log out and re-authenticate"
              style={{
                minWidth: 70,
                minHeight: 40,
                height: 40,
                paddingLeft: 12,
                paddingRight: 12,
                fontSize: 13,
              }}
            >
              Logout
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void handleManualRefresh()}
              disabled={refreshing}
              title="Refresh all prices now (auto: 30s)"
              style={{
                minWidth: 40,
                minHeight: 40,
                width: 40,
                height: 40,
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                borderRadius: '50%',
                opacity: refreshing ? 0.6 : 1,
                animation: refreshing ? 'spin 1s linear infinite' : 'none',
                transition: 'all 0.15s ease',
                background: refreshComplete ? 'var(--accent, #3d8bfd)' : undefined,
                boxShadow: refreshComplete ? '0 0 12px rgba(61, 139, 253, 0.5)' : undefined,
              }}
            >
              {refreshComplete ? '✓' : '↻'}
            </button>
          </div>
        </div>
        {store.error && (
          <div className="caveat" role="alert">
            {store.error}
          </div>
        )}
        {store.view === 'overview' && <Overview store={store} watchlistRef={watchlistRef} />}
        {store.view === 'positions' && <Positions store={store} />}
        {store.view === 'trades' && <Trades store={store} />}
        {store.view === 'charges' && <Charges store={store} />}
        {store.view === 'charts' && <Charts store={store} />}
        {store.view === 'research' && <Research researchRef={researchRef} />}
        {store.view === 'paper' && <Paper />}
        {store.view === 'paperFlex' && <PaperFlex />}
        {store.view === 'cryptoPaper' && <CryptoPaper />}
      </main>
    </div>
  );
}
