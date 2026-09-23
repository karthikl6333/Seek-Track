import './App.css';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { ViewId } from './types';
import { refreshPaperData, refreshCryptoPaperLivePnl, refreshPaperFlexData } from './lib/db';
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

const AUTO_REFRESH_HOT_INTERVAL_MS = 30_000; // 30 seconds for hot tier (holdings + watchlist)
const AUTO_REFRESH_COLD_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes for cold tier (research, etc.)

export default function App() {
  const store = useStore();
  const watchlistRef = useRef<WatchlistRef>(null);
  const researchRef = useRef<ResearchRef>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshComplete, setRefreshComplete] = useState(false);
  const hotRefreshIntervalRef = useRef<number | null>(null);
  const coldRefreshIntervalRef = useRef<number | null>(null);
  const autoRefreshingRef = useRef(false);
  const lastColdRefreshAt = useRef<number>(0);

  /**
   * Hot tier refresh: holdings + watchlist (30s cadence)
   */
  const refreshHotTier = useCallback(async () => {
    if (autoRefreshingRef.current) return;
    autoRefreshingRef.current = true;
    
    try {
      // Hot refresh: server will only refresh holdings + watchlist
      await store.refreshLiveQuotes([], 'hot');
      
      // Re-read all client state from shared store (GET only, no POST)
      await Promise.allSettled([
        store.refresh(), // Re-reads marks, updates holdings/positions
        watchlistRef.current?.reload(), // GET /api/watchlist (re-reads marks join)
      ]);
    } catch (error) {
      console.error('[App] Hot tier refresh error:', error);
    } finally {
      autoRefreshingRef.current = false;
    }
  }, [store]);

  /**
   * Cold tier refresh: research universe, ETFs, pair cache (15m cadence)
   */
  const refreshColdTier = useCallback(async () => {
    if (autoRefreshingRef.current) return;
    autoRefreshingRef.current = true;
    
    try {
      // Full refresh: server will refresh entire universe
      await store.refreshLiveQuotes([], 'full');
      
      // Re-read all client state from shared store
      await Promise.allSettled([
        store.refresh(),
        watchlistRef.current?.reload(),
        researchRef.current?.reload(), // Research benefits from cold tier
        refreshPaperData().catch(() => null),
        refreshCryptoPaperLivePnl().catch(() => null),
        refreshPaperFlexData().catch(() => null),
      ]);
      
      lastColdRefreshAt.current = Date.now();
    } catch (error) {
      console.error('[App] Cold tier refresh error:', error);
    } finally {
      autoRefreshingRef.current = false;
    }
  }, [store]);

  /**
   * Unified refresh (hot tier only for fast UI response)
   */
  const refreshPortalPrices = useCallback(async () => {
    // Manual/topbar refresh uses hot tier for fast response
    return refreshHotTier();
  }, [refreshHotTier]);

  /**
   * Manual refresh button (with animation)
   */
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    setRefreshComplete(false);
    try {
      await refreshPortalPrices();
      setRefreshComplete(true);
      setTimeout(() => setRefreshComplete(false), 1500);
    } catch (error) {
      console.error('Manual refresh error:', error);
    } finally {
      setRefreshing(false);
    }
  }, [refreshPortalPrices]);

  /**
   * Dual-tier refresh system:
   * - Hot tier (holdings + watchlist): 30s interval
   * - Cold tier (research, ETFs, pairs): 15m interval
   * Both pause when tab is hidden
   */
  useEffect(() => {
    // Initial hot refresh on mount
    const initialHotTimer = setTimeout(() => {
      void refreshHotTier();
    }, 2000); // 2s delay for initial load

    // Initial cold refresh on mount
    const initialColdTimer = setTimeout(() => {
      void refreshColdTier();
    }, 5000); // 5s delay, after hot

    // Set up 30s hot tier interval
    hotRefreshIntervalRef.current = window.setInterval(() => {
      // Skip refresh if tab is hidden (save Yahoo quota)
      if (document.hidden) {
        console.log('[App] Skipping hot refresh (tab hidden)');
        return;
      }
      void refreshHotTier();
    }, AUTO_REFRESH_HOT_INTERVAL_MS);

    // Set up 15m cold tier interval
    coldRefreshIntervalRef.current = window.setInterval(() => {
      if (document.hidden) {
        console.log('[App] Skipping cold refresh (tab hidden)');
        return;
      }
      void refreshColdTier();
    }, AUTO_REFRESH_COLD_INTERVAL_MS);

    // Resume immediately when tab becomes visible
    const handleVisibilityChange = () => {
      if (!document.hidden && !autoRefreshingRef.current) {
        console.log('[App] Tab visible, triggering refresh');
        void refreshHotTier(); // Always refresh hot tier
        
        // Refresh cold tier if it's been >15m since last cold refresh
        const coldAge = Date.now() - lastColdRefreshAt.current;
        if (coldAge > AUTO_REFRESH_COLD_INTERVAL_MS) {
          void refreshColdTier();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimeout(initialHotTimer);
      clearTimeout(initialColdTimer);
      if (hotRefreshIntervalRef.current !== null) {
        clearInterval(hotRefreshIntervalRef.current);
        hotRefreshIntervalRef.current = null;
      }
      if (coldRefreshIntervalRef.current !== null) {
        clearInterval(coldRefreshIntervalRef.current);
        coldRefreshIntervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshHotTier, refreshColdTier]);

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
                title={store.lastRefreshError}
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
              onClick={() => void refreshAll()}
              disabled={refreshing}
              title="Refresh all data now (auto-refresh every 15s)"
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
