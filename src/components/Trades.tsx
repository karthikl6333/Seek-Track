import { useMemo, useState } from 'react';
import type { Store } from '../hooks/useStore';
import { fmtMoney, fmtQty } from '../lib/format';

export function Trades({ store }: { store: Store }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const sorted = [...store.trades].sort((a, b) => {
      const da = Date.parse(a.date) || 0;
      const db = Date.parse(b.date) || 0;
      return db - da;
    });
    const needle = q.trim().toUpperCase();
    if (!needle) return sorted;
    return sorted.filter(
      (t) =>
        t.symbol.includes(needle) ||
        t.action.toUpperCase().includes(needle) ||
        t.description.toUpperCase().includes(needle),
    );
  }, [store.trades, q]);

  return (
    <div className="card">
      <h3>Trade Blotter</h3>
      <div className="field" style={{ maxWidth: 320 }}>
        <label>Filter</label>
        <input
          placeholder="Symbol, action, description…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="table-wrap" style={{ maxHeight: 640 }}>
        <table className="data">
          <thead>
            <tr>
              <th className="left">Date</th>
              <th className="left">Action</th>
              <th className="left">Symbol</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Fees</th>
              <th>Amount</th>
              <th className="left">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="left mono">{t.date}</td>
                <td className="left">{t.action}</td>
                <td className="left mono">{t.symbol}</td>
                <td className="mono">{fmtQty(t.quantity)}</td>
                <td className="mono">{fmtMoney(t.price, 4)}</td>
                <td className="mono">{fmtMoney(t.fees)}</td>
                <td className="mono">{fmtMoney(t.amount)}</td>
                <td className="left">
                  <input
                    style={{ width: '100%', minWidth: 120 }}
                    defaultValue={t.note ?? ''}
                    placeholder="Add note"
                    onBlur={(e) => {
                      const v = e.target.value;
                      if (v !== (t.note ?? '')) void store.updateNote(t.id, v);
                    }}
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="left muted" colSpan={8}>
                  No trades yet. Import a Schwab-style CSV from Overview.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
