import './App.css';
import { useCallback, useRef } from 'react';
import { Charges } from './pages/charges/Charges';
import { Charts } from './pages/charts/Charts';
import { Research, type ResearchRef } from './pages/research/Research';
import { Overview } from './pages/overview/Overview';
import { Paper } from './pages/paper/Paper';
import { CryptoPaper } from './pages/paper/CryptoPaper';
import { PaperFlex } from './pages/paper/PaperFlex';
import { Positions } from './pages/positions/Positions';
import { Trades } from './pages/trades/Trades';
import type { WatchlistRef } from './pages/overview/Watchlist';
import { useStore } from './hooks/useStore';
import { useRefreshScheduler } from './hooks/useRefreshScheduler';
import { useLiveQuotesToggle } from './hooks/useLiveQuotesToggle';
import { useMarksStream } from './hooks/useMarksStream';
import { Sidebar } from './app/Sidebar';
import { Topbar } from './app/Topbar';
import { BootScreen } from './app/StatusScreens';
import { logout } from './app/logout';

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

  const { closedWindow, refreshing, refreshComplete, handleManualRefresh } = useRefreshScheduler({
    storeRef,
    watchlistRef,
    researchRef,
  });
  const { liveQuotesEnabled, toggleLiveQuotes } = useLiveQuotesToggle();
  const { liveConnected } = useMarksStream({
    enabled: liveQuotesEnabled && !closedWindow, // prices don't move on weekends/holidays
    storeRef,
    watchlistRef,
    researchRef,
  });

  const handleLogout = useCallback(() => logout(), []);

  if (!store.ready || !store.settings) {
    return <BootScreen authError={Boolean(store.authError)} />;
  }

  return (
    <div className="app-shell">
      <Sidebar view={store.view} onSelect={store.setView} />
      <main className="main">
        <Topbar
          view={store.view}
          liveQuotesEnabled={liveQuotesEnabled}
          liveConnected={liveConnected}
          closedWindow={closedWindow}
          lastRefreshError={store.lastRefreshError}
          refreshing={refreshing}
          refreshComplete={refreshComplete}
          onToggleLive={toggleLiveQuotes}
          onLogout={handleLogout}
          onManualRefresh={handleManualRefresh}
        />
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
