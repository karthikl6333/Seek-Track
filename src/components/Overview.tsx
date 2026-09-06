import type { Store } from '../hooks/useStore';
import { fmtMoney, pnlClass } from '../lib/format';
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
          <div className="stat-label">Requires manual marks</div>
        </div>
      </div>

      <div className="content-split">
        <div className="stack">
          <CsvImport onImport={store.importCsvText} lastResult={store.importResult} />
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
          <Calculator calc={store.calc} setCalc={store.setCalc} whatIf={store.whatIf} />
          {settings && <CrossCheck pairs={settings.pairs} />}
          <MarkPrices
            positions={analysis?.positions ?? []}
            marks={store.marks}
            onSave={store.setMarkPrice}
          />
        </div>
      </div>
    </div>
  );
}
