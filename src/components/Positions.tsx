import { useState } from 'react';
import type { Store } from '../hooks/useStore';
import { fmtMoney, fmtPct, fmtQty, pnlClass } from '../lib/format';
import { AddTradeForm } from './AddTradeForm';

export function Positions({ store }: { store: Store }) {
  const { hiddenSet } = store;
  const [showHidden, setShowHidden] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const allRows = store.analysis?.positions.filter((p) => p.quantity !== 0) ?? [];
  const hiddenCount = allRows.filter((p) => hiddenSet.has(p.symbol.toUpperCase())).length;
  const rows = showHidden
    ? allRows
    : allRows.filter((p) => !hiddenSet.has(p.symbol.toUpperCase()));

  const handleRefreshPrices = async () => {
    setRefreshing(true);
    try {
      const openSymbols = allRows.map((p) => p.symbol);
      await store.refreshLiveQuotes(openSymbols);
    } finally {
      setRefreshing(false);
    }
  };

  const lastUpdatedLabel = store.lastRefreshAt
    ? new Date(store.lastRefreshAt).toLocaleString(undefined, { timeZone: 'Asia/Kolkata' }) + ' IST'
    : null;

  return (
    <div className="stack">
      <AddTradeForm onSubmit={store.addManualTrade} />

      <div className="card">
        <div className="row-actions" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Open Positions &amp; Lots</h3>
          <div className="row-actions" style={{ gap: 8 }}>
            {hiddenCount > 0 && (
              <button
                type="button"
                className="btn small"
                onClick={() => setShowHidden((v) => !v)}
              >
                {showHidden ? 'Hide hidden' : `Show hidden (${hiddenCount})`}
              </button>
            )}
            <button
              type="button"
              className="btn small"
              disabled={refreshing}
              onClick={handleRefreshPrices}
              title="Refresh prices for all open positions"
              style={{
                opacity: refreshing ? 0.6 : 1,
                transition: 'opacity 0.15s',
                cursor: refreshing ? 'wait' : 'pointer',
              }}
            >
              {refreshing ? '⟳ Refreshing...' : '↻ Refresh prices'}
            </button>
          </div>
        </div>
        {store.lastRefreshError && (
          <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 8, color: '#e67e22' }}>
            ⚠ Refresh error: {store.lastRefreshError}. Some prices may be stale.
          </p>
        )}
        {lastUpdatedLabel && (
          <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 8 }}>
            Last updated: {lastUpdatedLabel}
          </p>
        )}
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="left">Symbol</th>
                <th className="left">Theme</th>
                <th>Qty</th>
                <th>Avg cost</th>
                <th>Mark</th>
                <th>Mkt value</th>
                <th>Unreal. P&amp;L</th>
                <th>Unreal. %</th>
                <th>Realized</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const isHidden = hiddenSet.has(p.symbol.toUpperCase());
                return (
                  <tr key={p.symbol} style={isHidden ? { opacity: 0.55 } : undefined}>
                    <td className="left mono">
                      {p.symbol}
                      {isHidden && (
                        <span className="badge" style={{ marginLeft: 6 }}>
                          hidden
                        </span>
                      )}
                    </td>
                    <td className="left">{p.theme}</td>
                    <td className="mono">{fmtQty(p.quantity)}</td>
                    <td className="mono">{fmtMoney(p.avgCost, 4)}</td>
                    <td className="mono">
                      {fmtMoney(p.markPrice, 4)}
                      {store.markDetails[p.symbol] && (
                        <span className="muted" style={{ display: 'block', fontSize: 11 }}>
                          {store.markDetails[p.symbol].source}
                        </span>
                      )}
                    </td>
                    <td className="mono">{fmtMoney(p.marketValue)}</td>
                    <td className={pnlClass(p.unrealizedPnl)}>{fmtMoney(p.unrealizedPnl)}</td>
                    <td className={pnlClass(p.unrealizedPnlPct)}>{fmtPct(p.unrealizedPnlPct)}</td>
                    <td className={pnlClass(p.realizedPnl)}>{fmtMoney(p.realizedPnl)}</td>
                    <td>
                      <div className="row-actions" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => {
                            store.loadPositionIntoCalc(p.symbol);
                            store.setView('overview');
                          }}
                          title="Load into what-if calculator"
                        >
                          → Calc
                        </button>
                        <button
                          type="button"
                          className="btn small ghost"
                          onClick={() => void store.toggleHiddenSymbol(p.symbol)}
                        >
                          {isHidden ? 'Unhide' : 'Hide'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td className="left muted" colSpan={10}>
                    {allRows.length > 0 && !showHidden
                      ? 'All open positions are hidden. Click “Show hidden”.'
                      : 'No open lots. Import buys/sells or set marks after opening positions.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {rows.map((p) => (
        <div className="card" key={`lots-${p.symbol}`}>
          <h3>
            Lots — {p.symbol} <span className="badge">{p.openLots.length} open</span>
          </h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="left">Opened</th>
                  <th>Qty</th>
                  <th>Cost/share</th>
                  <th>Fees alloc</th>
                </tr>
              </thead>
              <tbody>
                {p.openLots.map((l) => (
                  <tr key={l.id}>
                    <td className="left mono">{l.openDate}</td>
                    <td className="mono">{fmtQty(l.quantity)}</td>
                    <td className="mono">{fmtMoney(l.costPerShare, 4)}</td>
                    <td className="mono">{fmtMoney(l.feesAllocated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
