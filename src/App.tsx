import './App.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Charges } from './components/Charges';
import { Charts } from './components/Charts';
import { Research } from './components/Research';
import { Overview } from './components/Overview';
import { Paper } from './components/Paper';
import { CryptoPaper } from './components/CryptoPaper';
import { Positions } from './components/Positions';
import { Trades } from './components/Trades';
import { useStore } from './hooks/useStore';
import type { ViewId } from './types';
import { refreshPaperData, refreshCryptoPaperLivePnl } from './lib/db';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

const NAV: { id: ViewId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'positions', label: 'Positions' },
  { id: 'trades', label: 'Trades' },
  { id: 'charges', label: 'Charges' },
  { id: 'charts', label: 'Charts' },
  { id: 'research', label: 'Research' },
  { id: 'paper', label: 'Paper' },
  { id: 'cryptoPaper', label: 'Crypto Paper' },
];

const WATCH_MODE_INTERVAL_MS = 30_000; // 30 seconds
const WATCH_MODE_STORAGE_KEY = 'seektrack_watch_mode';

export default function App() {
  const store = useStore();
  const [refreshing, setRefreshing] = useState(false);
  const [watchModeEnabled, setWatchModeEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem(WATCH_MODE_STORAGE_KEY);
      return stored === 'true';
    } catch {
      return false;
    }
  });
  const watchModeIntervalRef = useRef<number | null>(null);
  const watchModeRefreshingRef = useRef(false);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([
        store.refreshLiveQuotes(),
        store.refresh(),
        fetch(`${API_BASE}/api/watchlist/refresh`, { method: 'POST' }).catch(() => null),
        refreshPaperData().catch(() => null),
        refreshCryptoPaperLivePnl().catch(() => null),
      ]);
    } catch (error) {
      console.error('Global refresh error:', error);
    } finally {
      setRefreshing(false);
    }
  }, [store]);

  const refreshWatchMode = useCallback(async () => {
    if (watchModeRefreshingRef.current) return;
    watchModeRefreshingRef.current = true;
    try {
      await Promise.allSettled([
        store.refreshLiveQuotes(),
        fetch(`${API_BASE}/api/watchlist/refresh`, { method: 'POST' }).catch(() => null),
      ]);
    } catch (error) {
      console.error('Watch mode refresh error:', error);
    } finally {
      watchModeRefreshingRef.current = false;
    }
  }, [store]);

  useEffect(() => {
    if (watchModeEnabled) {
      watchModeIntervalRef.current = window.setInterval(() => {
        void refreshWatchMode();
      }, WATCH_MODE_INTERVAL_MS);
      return () => {
        if (watchModeIntervalRef.current !== null) {
          clearInterval(watchModeIntervalRef.current);
          watchModeIntervalRef.current = null;
        }
      };
    } else {
      if (watchModeIntervalRef.current !== null) {
        clearInterval(watchModeIntervalRef.current);
        watchModeIntervalRef.current = null;
      }
    }
  }, [watchModeEnabled, refreshWatchMode]);

  const toggleWatchMode = useCallback(() => {
    setWatchModeEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(WATCH_MODE_STORAGE_KEY, String(next));
      } catch (error) {
        console.warn('Failed to persist watch mode preference:', error);
      }
      return next;
    });
  }, []);

  if (!store.ready || !store.settings) {
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
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                fontSize: 13,
                userSelect: 'none',
              }}
              title="Auto-refresh holdings and watchlist every 30 seconds"
            >
              <div
                style={{
                  position: 'relative',
                  width: 40,
                  height: 20,
                  borderRadius: 10,
                  background: watchModeEnabled ? 'var(--accent, #3d8bfd)' : 'rgba(255,255,255,0.15)',
                  transition: 'background 0.2s',
                  cursor: 'pointer',
                }}
                onClick={toggleWatchMode}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 2,
                    left: watchModeEnabled ? 22 : 2,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: '#fff',
                    transition: 'left 0.2s',
                  }}
                />
              </div>
              <span style={{ color: 'var(--text)' }}>
                Watch{watchModeEnabled ? ' · 30s' : ''}
              </span>
            </label>
            <button
              type="button"
              className="btn"
              onClick={() => void refreshAll()}
              disabled={refreshing}
              title="Refresh all data (quotes, marks, paper, crypto, watchlist)"
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
                animation: refreshing ? 'spin 1s linear infinite' : 'none',
              }}
            >
              {refreshing ? '⟳' : '↻'}
            </button>
          </div>
        </div>
        {store.error && (
          <div className="caveat" role="alert">
            {store.error}
          </div>
        )}
        {store.view === 'overview' && <Overview store={store} />}
        {store.view === 'positions' && <Positions store={store} />}
        {store.view === 'trades' && <Trades store={store} />}
        {store.view === 'charges' && <Charges store={store} />}
        {store.view === 'charts' && <Charts store={store} />}
        {store.view === 'research' && <Research />}
        {store.view === 'paper' && <Paper />}
        {store.view === 'cryptoPaper' && <CryptoPaper />}
      </main>
    </div>
  );
}
