import './App.css';
import { Charts } from './components/Charts';
import { Journal } from './components/Journal';
import { Overview } from './components/Overview';
import { Positions } from './components/Positions';
import { SettingsPanel } from './components/SettingsPanel';
import { Trades } from './components/Trades';
import { useStore } from './hooks/useStore';
import type { ViewId } from './types';

const NAV: { id: ViewId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'positions', label: 'Positions' },
  { id: 'trades', label: 'Trades' },
  { id: 'journal', label: 'Journal' },
  { id: 'charts', label: 'Charts' },
];

export default function App() {
  const store = useStore();

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
          <h1>Seek&amp;Track</h1>
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
          <span className="badge">{store.trades.length} trades persisted</span>
        </div>
        {store.error && (
          <div className="caveat" role="alert">
            {store.error}
          </div>
        )}
        {store.view === 'overview' && (
          <div className="stack">
            <Overview store={store} />
            <SettingsPanel settings={store.settings} onSave={store.updateSettings} />
          </div>
        )}
        {store.view === 'positions' && <Positions store={store} />}
        {store.view === 'trades' && <Trades store={store} />}
        {store.view === 'journal' && <Journal store={store} />}
        {store.view === 'charts' && <Charts store={store} />}
      </main>
    </div>
  );
}
