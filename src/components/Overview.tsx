import type { Store } from '../hooks/useStore';
import { fmtMoney, fmtPct, fmtQty, pnlClass } from '../lib/format';
import { AddTradeForm } from './AddTradeForm';
import { Calculator } from './Calculator';
import { CrossCheck } from './CrossCheck';
import { CsvImport } from './CsvImport';
import { MarkPrices } from './MarkPrices';

export function Overview({ store }: { store: Store }) {
  const { analysis, settings } = store;
  const realized = analysis?.positions.reduce((s, p) => s + p.realizedPnl, 0) ?? 0;
  const openPositions = analysis?.positions.filter((p) => p.quantity !== 0) ?? [];
  const unrealizedParts = openPositions.map((p) => p.unrealizedPnl);
  const hasAllMarks = openPositions.length > 0 && unrealizedParts.every((u) => u !== null);
  const unrealized = openPositions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);

  const lastUpdatedLabel = store.lastRefreshAt
    ? new Date(store.lastRefreshAt).toLocaleString(undefined, { timeZone: 'Asia/Kolkata' }) +
      ' IST'
    : openPositions
          .map((p) => store.markDetails[p.symbol]?.updatedAt)
          .filter(Boolean)
          .sort()
          .at(-1)
      ? new Date(
          openPositions
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
          <div className="stat-value mono">{openPositions.length}</div>
          <div className="stat-label">Non-zero positions</div>
        </div>
        <div className="card">
          <h3>Realized P&amp;L</h3>
          <div className={`stat-value ${pnlClass(realized)}`}>{fmtMoney(realized)}</div>
          <div className="stat-label">Closed lots (FIFO)</div>
        </div>
        <div className="card">
          <h3>Unrealized P&amp;L</h3>
          <div className={`stat-value ${pnlClass(hasAllMarks ? unrealized : null)}`}>
            {hasAllMarks || openPositions.length === 0 ? fmtMoney(unrealized) : 'Set marks'}
          </div>
          <div className="stat-label">
            Live marks when available
            {lastUpdatedLabel ? ` · ${lastUpdatedLabel}` : ''}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row-actions" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Holdings (open positions)</h3>
          <button
            type="button"
            className="btn small"
            onClick={() => void store.refreshLiveQuotes()}
            title="Fetch Yahoo quotes for open symbols + calculator"
          >
            Refresh quotes
          </button>
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
                return (
                  <tr key={p.symbol}>
                    <td className="left mono">
                      {p.symbol}
                      {info && (
                        <span className="muted" style={{ display: 'block', fontSize: 11 }}>
                          {info.source}
                        </span>
                      )}
                    </td>
                    <td className="mono">{fmtQty(p.quantity)}</td>
                    <td className="mono">{fmtMoney(p.avgCost, 4)}</td>
                    <td className="mono">{fmtMoney(p.markPrice, 4)}</td>
                    <td className="mono">{fmtMoney(p.marketValue)}</td>
                    <td className={pnlClass(p.unrealizedPnl)}>{fmtMoney(p.unrealizedPnl)}</td>
                    <td className={pnlClass(p.unrealizedPnlPct)}>{fmtPct(p.unrealizedPnlPct)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => store.loadPositionIntoCalc(p.symbol)}
                      >
                        → Calc
                      </button>
                    </td>
                  </tr>
                );
              })}
              {openPositions.length === 0 && (
                <tr>
                  <td className="left muted" colSpan={8}>
                    No open holdings. Import CSV or add a manual trade.
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

      <div className="content-split">
        <div className="stack">
          <CsvImport onImport={store.importCsvText} lastResult={store.importResult} />
          <AddTradeForm onSubmit={store.addManualTrade} />
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
        <div className="stack">
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
          />
          {settings && <CrossCheck pairs={settings.pairs} />}
          <MarkPrices
            positions={analysis?.positions ?? []}
            marks={store.marks}
            markDetails={store.markDetails}
            lastRefreshAt={store.lastRefreshAt}
            onSave={store.setMarkPrice}
            onRefresh={() => void store.refreshLiveQuotes()}
          />
        </div>
      </div>
    </div>
  );
}
