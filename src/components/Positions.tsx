import type { Store } from '../hooks/useStore';
import { fmtMoney, fmtPct, fmtQty, pnlClass } from '../lib/format';

export function Positions({ store }: { store: Store }) {
  const rows = store.analysis?.positions.filter((p) => p.quantity !== 0) ?? [];

  return (
    <div className="stack">
      <div className="card">
        <h3>Open Positions &amp; Lots</h3>
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
              {rows.map((p) => (
                <tr key={p.symbol}>
                  <td className="left mono">{p.symbol}</td>
                  <td className="left">{p.theme}</td>
                  <td className="mono">{fmtQty(p.quantity)}</td>
                  <td className="mono">{fmtMoney(p.avgCost, 4)}</td>
                  <td className="mono">{fmtMoney(p.markPrice, 4)}</td>
                  <td className="mono">{fmtMoney(p.marketValue)}</td>
                  <td className={pnlClass(p.unrealizedPnl)}>{fmtMoney(p.unrealizedPnl)}</td>
                  <td className={pnlClass(p.unrealizedPnlPct)}>{fmtPct(p.unrealizedPnlPct)}</td>
                  <td className={pnlClass(p.realizedPnl)}>{fmtMoney(p.realizedPnl)}</td>
                  <td>
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
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="left muted" colSpan={10}>
                    No open lots. Import buys/sells or set marks after opening positions.
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
