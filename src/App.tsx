import './App.css';
import { useCallback, useState } from 'react';
import { Charges } from './components/Charges';
import { Charts } from './components/Charts';
import { Research } from './components/Research';
import { Journal } from './components/Journal';
import { Overview } from './components/Overview';
import { Paper } from './components/Paper';
import { CryptoPaper } from './components/CryptoPaper';
import { Positions } from './components/Positions';
import { SettingsPanel } from './components/SettingsPanel';
import { Trades } from './components/Trades';
import { useStore } from './hooks/useStore';
import type { ViewId } from './types';
import { refreshPaperData, refreshCryptoPaperLivePnl } from './lib/db';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

const NAV: { id: ViewId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'pairs', label: 'Pairs & Themes' },
  { id: 'positions', label: 'Positions' },
  { id: 'trades', label: 'Trades' },
  { id: 'journal', label: 'Journal' },
  { id: 'charges', label: 'Charges' },
  { id: 'charts', label: 'Charts' },
  { id: 'research', label: 'Research' },
  { id: 'paper', label: 'Paper' },
  { id: 'cryptoPaper', label: 'Crypto Paper' },
];

export default function App() {
  const store = useStore();
  const [refreshing, setRefreshing] = useState(false);

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
        {store.error && (
          <div className="caveat" role="alert">
            {store.error}
          </div>
        )}
        {store.view === 'overview' && <Overview store={store} />}
        {store.view === 'pairs' && (
          <SettingsPanel settings={store.settings} onSave={store.updateSettings} />
        )}
        {store.view === 'positions' && <Positions store={store} />}
        {store.view === 'trades' && <Trades store={store} />}
        {store.view === 'journal' && <Journal store={store} />}
        {store.view === 'charges' && <Charges store={store} />}
        {store.view === 'charts' && <Charts store={store} />}
        {store.view === 'research' && <Research />}
        {store.view === 'paper' && <Paper />}
        {store.view === 'cryptoPaper' && <CryptoPaper />}
      </main>
    </div>
  );
}
