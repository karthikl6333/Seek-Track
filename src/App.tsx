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
import { getQuoteUniverse, refreshPaperData, refreshCryptoPaperLivePnl, refreshPaperFlexData } from './lib/db';
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

const AUTO_REFRESH_INTERVAL_MS = 30_000; // 30 seconds
const CHUNK_SIZE = 10; // Max symbols per HTTP request (CF Workers limit)

export default function App() {
  const store = useStore();
  const watchlistRef = useRef<WatchlistRef>(null);
  const researchRef = useRef<ResearchRef>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshComplete, setRefreshComplete] = useState(false);
  const refreshIntervalRef = useRef<number | null>(null);
  const autoRefreshingRef = useRef(false);

  /**
   * Chunked refresh at HTTP boundary to stay under CF Workers subrequest limits
   * 
   * 1. GET /api/quotes/universe (1 Neon query)
   * 2. POST /api/quotes/refresh with ≤10 symbols (N Yahoo + 2 Neon per request)
   * 3. Repeat for each chunk
   */
  const refreshAll = useCallback(async () => {
    if (autoRefreshingRef.current) return;
    autoRefreshingRef.current = true;
    
    try {
      // Get full symbol universe (1 HTTP request, 1 Neon query)
      const { symbols: universe } = await getQuoteUniverse();
      console.log(`[App] Refreshing ${universe.length} symbols in chunks of ${CHUNK_SIZE}`);
      
      // Refresh in chunks (multiple HTTP requests, each stays under CF limit)
      for (let i = 0; i < universe.length; i += CHUNK_SIZE) {
        const chunk = universe.slice(i, i + CHUNK_SIZE);
        await store.refreshLiveQuotes(chunk);
        console.log(
          `[App] Chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(universe.length / CHUNK_SIZE)} complete`
        );
      }
      
      // Re-read all client state from shared store
      await Promise.allSettled([
        store.refresh(),
        watchlistRef.current?.reload(),
        researchRef.current?.reload(),
        refreshPaperData().catch(() => null),
        refreshCryptoPaperLivePnl().catch(() => null),
        refreshPaperFlexData().catch(() => null),
      ]);
    } catch (error) {
      console.error('[App] Refresh error:', error);
    } finally {
      autoRefreshingRef.current = false;
    }
  }, [store]);

  /**
   * Manual refresh button (with animation)
   */
  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshComplete(false);
    try {
      await refreshAll();
      setRefreshComplete(true);
      setTimeout(() => setRefreshComplete(false), 1500);
    } catch (error) {
      console.error('Manual refresh error:', error);
    } finally {
      setRefreshing(false);
    }
  }, [refreshAll]);

  /**
   * Auto-refresh system:
   * - 30s interval for ALL symbols
   * - Pauses when tab is hidden
   */
  useEffect(() => {
    // Initial refresh on mount
    const initialTimer = setTimeout(() => {
      void refreshAll();
    }, 2000); // 2s delay for initial load

    // Set up 30s interval
    refreshIntervalRef.current = window.setInterval(() => {
      // Skip refresh if tab is hidden (save Yahoo quota)
      if (document.hidden) {
        console.log('[App] Skipping auto-refresh (tab hidden)');
        return;
      }
      void refreshAll();
    }, AUTO_REFRESH_INTERVAL_MS);

    // Resume immediately when tab becomes visible
    const handleVisibilityChange = () => {
      if (!document.hidden && !autoRefreshingRef.current) {
        console.log('[App] Tab visible, triggering refresh');
        void refreshAll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimeout(initialTimer);
      if (refreshIntervalRef.current !== null) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshAll]);

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
