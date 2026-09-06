import { useState } from 'react';
import type { Store } from '../hooks/useStore';
import { fmtMoney, fmtPct, fmtQty, moneyTone, pnlClass } from '../lib/format';
import { Watchlist } from './Watchlist';
import { Calculator } from './Calculator';
import { CrossCheck } from './CrossCheck';
import { CsvImport } from './CsvImport';

export function Overview({ store }: { store: Store }) {
  const { analysis, settings, hiddenSet } = store;
  const [showHidden, setShowHidden] = useState(false);

  const allOpen = analysis?.positions.filter((p) => p.quantity !== 0) ?? [];
  const visibleOpen = allOpen.filter((p) => !hiddenSet.has(p.symbol.toUpperCase()));
  const hiddenOpen = allOpen.filter((p) => hiddenSet.has(p.symbol.toUpperCase()));
  const openPositions = showHidden ? allOpen : visibleOpen;

  // Totals exclude hidden symbols (unless viewing them only for display — totals stay on visible)
  const totalsPositions = visibleOpen;
  const realized =
    analysis?.positions
      .filter((p) => !hiddenSet.has(p.symbol.toUpperCase()))
      .reduce((s, p) => s + p.realizedPnl, 0) ?? 0;
  const unrealizedParts = totalsPositions.map((p) => p.unrealizedPnl);
  const hasAllMarks = totalsPositions.length > 0 && unrealizedParts.every((u) => u !== null);
  const unrealized = totalsPositions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);

  const lastUpdatedLabel = store.lastRefreshAt
    ? new Date(store.lastRefreshAt).toLocaleString(undefined, { timeZone: 'Asia/Kolkata' }) +
      ' IST'
    : totalsPositions
          .map((p) => store.markDetails[p.symbol]?.updatedAt)
          .filter(Boolean)
          .sort()
          .at(-1)
      ? new Date(
          totalsPositions
            .map((p) => store.markDetails[p.symbol]?.updatedAt)
            .filter(Boolean)
            .sort()
            .at(-1)!,
        ).toLocaleString(undefined, { timeZone: 'Asia/Kolkata' }) + ' IST'
      : null;

  return (
    <div className="stack">
      <div className="grid-4">
        <div className="card">
          <h3>Trades</h3>
          <div className="stat-value mono">{store.trades.length}</div>
          <div className="stat-label">Imported rows (deduped)</div>
        </div>
        <div className="card">
          <h3>Open symbols</h3>
          <div className="stat-value mono">{totalsPositions.length}</div>
          <div className="stat-label">
            Non-zero positions
            {hiddenOpen.length > 0 ? ` · ${hiddenOpen.length} hidden` : ''}
          </div>
        </div>
        <div className="card">
          <h3>Realized P&amp;L</h3>
          <div className={`stat-value ${pnlClass(realized)} ${moneyTone("stat")}`}>{fmtMoney(realized)}</div>
          <div className="stat-label">Closed lots (FIFO){hiddenOpen.length ? ' · excl. hidden' : ''}</div>
        </div>
        <div className="card">
          <h3>Unrealized P&amp;L</h3>
          <div className={`stat-value ${pnlClass(hasAllMarks ? unrealized : null)} ${moneyTone("stat")}`}>
            {hasAllMarks || totalsPositions.length === 0 ? fmtMoney(unrealized) : 'Set marks'}
          </div>
          <div className="stat-label">
            Live marks when available
            {hiddenOpen.length ? ' · excl. hidden' : ''}
            {lastUpdatedLabel ? ` · ${lastUpdatedLabel}` : ''}
          </div>
        </div>
      </div>

      <Watchlist />

      <CsvImport onImport={store.importCsvText} lastResult={store.importResult} />

      <div className="card">
        <div className="row-actions" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Holdings (open positions)</h3>
          <div className="row-actions" style={{ gap: 8 }}>
            {hiddenOpen.length > 0 && (
              <button
                type="button"
                className="btn small"
                onClick={() => setShowHidden((v) => !v)}
                title="Toggle rows you hid (CSV noise)"
              >
                {showHidden ? 'Hide hidden' : `Show hidden (${hiddenOpen.length})`}
              </button>
            )}
            <button
              type="button"
              className="btn small"
              onClick={() => void store.refreshLiveQuotes()}
              title="Fetch Yahoo quotes for open symbols + calculator + pair"
            >
              Refresh quotes
            </button>
          </div>
        </div>
        {store.lastRefreshError && (
          <p className="muted" style={{ fontSize: 12 }}>
            Quote refresh note: {store.lastRefreshError}. Fallback: enter marks manually below.
          </p>
        )}
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="left">Symbol</th>
                <th>Qty</th>
                <th>Avg cost</th>
                <th>Current</th>
                <th>Mkt value</th>
                <th>Unreal. $</th>
                <th>Unreal. %</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {openPositions.map((p) => {
                const info = store.markDetails[p.symbol];
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
                      {info && (
                        <span className="muted" style={{ display: 'block', fontSize: 11 }}>
                          {info.source}
                        </span>
                      )}
                    </td>
                    <td className="mono">{fmtQty(p.quantity)}</td>
                    <td className="mono">{fmtMoney(p.avgCost, 4)}</td>
                    <td className="mono">{fmtMoney(p.markPrice, 4)}</td>
                    <td className={moneyTone("notional")}>{fmtMoney(p.marketValue)}</td>
                    <td className={pnlClass(p.unrealizedPnl)}>{fmtMoney(p.unrealizedPnl)}</td>
                    <td className={pnlClass(p.unrealizedPnlPct)}>{fmtPct(p.unrealizedPnlPct)}</td>
                    <td>
                      <div className="row-actions" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => store.loadPositionIntoCalc(p.symbol)}
                        >
                          → Calc
                        </button>
                        <button
                          type="button"
                          className="btn small ghost"
                          onClick={() => void store.toggleHiddenSymbol(p.symbol)}
                          title={
                            isHidden
                              ? 'Unhide this symbol from holdings totals'
                              : 'Hide this symbol (CSV may be inaccurate)'
                          }
                        >
                          {isHidden ? 'Unhide' : 'Hide'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {openPositions.length === 0 && (
                <tr>
                  <td className="left muted" colSpan={8}>
                    {allOpen.length > 0 && !showHidden
                      ? 'All open holdings are hidden. Click “Show hidden”.'
                      : 'No open holdings. Import CSV or add a manual trade.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {lastUpdatedLabel && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Marks last updated: {lastUpdatedLabel} (auto-refresh ~15 min)
          </p>
        )}
      </div>

      <div className="calc-layout">
        <div className="stack calc-main">
          <Calculator
            calc={store.calc}
            setCalc={store.setCalc}
            whatIf={store.whatIf}
            resolvedPair={store.resolvedPair}
            pairBusy={store.pairBusy}
            onResolvePair={() => void store.resolveCalcPair()}
            markDetails={store.markDetails}
            marks={store.marks}
            settingsPairs={settings?.pairs ?? []}
            onRefreshQuotes={() => void store.refreshLiveQuotes()}
          />
          {settings && <CrossCheck pairs={settings.pairs} />}
        </div>
      </div>

      <div className="card">
        <h3>P&amp;L by Theme</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="left">Theme</th>
                <th>Realized</th>
                <th>Unrealized</th>
                <th>Cost basis</th>
                <th className="left">Symbols</th>
              </tr>
            </thead>
            <tbody>
              {(analysis?.themes ?? []).map((t) => (
                <tr key={t.theme}>
                  <td className="left">{t.theme}</td>
                  <td className={pnlClass(t.realizedPnl)}>{fmtMoney(t.realizedPnl)}</td>
                  <td className={pnlClass(t.unrealizedPnl)}>{fmtMoney(t.unrealizedPnl)}</td>
                  <td className="mono">{fmtMoney(t.costBasis)}</td>
                  <td className="left muted">{t.symbols.join(', ')}</td>
                </tr>
              ))}
              {(analysis?.themes.length ?? 0) === 0 && (
                <tr>
                  <td className="left muted" colSpan={5}>
                    Import trades to see theme rollups.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
