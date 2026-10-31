import type { ViewId } from '../types/index';
import { NAV } from './nav';

export function Sidebar({ view, onSelect }: { view: ViewId; onSelect: (id: ViewId) => void }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-row">
          <img src="/favicon.svg" alt="" className="brand-icon" width={22} height={22} />
          <h1>Seek&amp;Track</h1>
        </div>
        <p>Numbers-first trading ledger</p>
      </div>
      {NAV.map((n, i) => (
        <button
          key={n.id}
          type="button"
          className={`nav-btn${view === n.id ? ' active' : ''}`}
          onClick={() => onSelect(n.id)}
          aria-current={view === n.id ? 'page' : undefined}
        >
          <span className="nav-label">{n.label}</span>
          {i < 9 && <kbd className="nav-key" aria-hidden="true">{i + 1}</kbd>}
        </button>
      ))}
    </aside>
  );
}
