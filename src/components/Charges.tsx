import { useMemo, useState } from 'react';
import type { Store } from '../hooks/useStore';
import { listChargeRows, summarizeCharges, type ChargeKind } from '../lib/charges';
import { feeClass, fmtMoney, moneyTone } from '../lib/format';

const KIND_LABEL: Record<ChargeKind, string> = {
  fee: 'Fee',
  margin_interest: 'Margin interest',
  credit_interest: 'Credit interest',
  other_charge: 'Other charge',
};

type SortKey = 'date' | 'action' | 'symbol' | 'description' | 'fees' | 'amount' | 'kind';

export function Charges({ store }: { store: Store }) {
  const summary = useMemo(() => summarizeCharges(store.trades), [store.trades]);
  const rows = useMemo(() => listChargeRows(store.trades), [store.trades]);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const copy = [...rows];
    const dir = sortDir === 'asc' ? 1 : -1;
    copy.sort((a, b) => {
      if (sortKey === 'fees' || sortKey === 'amount') {
        return (a[sortKey] - b[sortKey]) * dir;
      }
      if (sortKey === 'date') {
        return ((Date.parse(a.date) || 0) - (Date.parse(b.date) || 0)) * dir;
      }
      return String(a[sortKey]).localeCompare(String(b[sortKey])) * dir;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'date' || key === 'fees' || key === 'amount' ? 'desc' : 'asc');
    }
  };

  const sortMark = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <div className="stack">
      <div className="grid-4">
        <div className="card">
          <h3>Total charges</h3>
          <div className={`stat-value ${moneyTone('fee')}`}>{fmtMoney(summary.totalCharges)}</div>
          <div className="stat-label">Fees + margin interest</div>
        </div>
        <div className="card">
          <h3>Fees</h3>
          <div className={`stat-value ${moneyTone('fee')}`}>{fmtMoney(summary.fees)}</div>
          <div className="stat-label">Fees &amp; commissions</div>
        </div>
        <div className="card">
          <h3>Margin interest</h3>
          <div className={`stat-value ${moneyTone('fee')}`}>{fmtMoney(summary.marginInterest)}</div>
          <div className="stat-label">Debit interest</div>
        </div>
        <div className="card">
          <h3>Credit interest</h3>
          <div className={`stat-value ${moneyTone('stat')}`}>{fmtMoney(summary.creditInterest)}</div>
          <div className="stat-label">Credit / cash interest</div>
        </div>
      </div>

      <div className="card">
        <h3>Charge &amp; interest rows</h3>
        <div className="table-wrap" style={{ maxHeight: 640 }}>
          <table className="data">
            <thead>
              <tr>
                <th className="left">
                  <button type="button" className="linkish" onClick={() => toggleSort('date')}>
                    Date{sortMark('date')}
                  </button>
                </th>
                <th className="left">
                  <button type="button" className="linkish" onClick={() => toggleSort('action')}>
                    Action{sortMark('action')}
                  </button>
                </th>
                <th className="left">
                  <button type="button" className="linkish" onClick={() => toggleSort('symbol')}>
                    Symbol{sortMark('symbol')}
                  </button>
                </th>
                <th className="left">
                  <button type="button" className="linkish" onClick={() => toggleSort('description')}>
                    Description{sortMark('description')}
                  </button>
                </th>
                <th>
                  <button type="button" className="linkish" onClick={() => toggleSort('fees')}>
                    Fees{sortMark('fees')}
                  </button>
                </th>
                <th>
                  <button type="button" className="linkish" onClick={() => toggleSort('amount')}>
                    Amount{sortMark('amount')}
                  </button>
                </th>
                <th className="left">
                  <button type="button" className="linkish" onClick={() => toggleSort('kind')}>
                    Type{sortMark('kind')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id}>
                  <td className="left mono">{r.date}</td>
                  <td className="left">{r.action}</td>
                  <td className="left mono">{r.symbol || '—'}</td>
                  <td className="left" style={{ maxWidth: 280, whiteSpace: 'normal' }}>
                    {r.description || '—'}
                  </td>
                  <td className={feeClass(r.fees)}>{fmtMoney(r.fees)}</td>
                  <td className="mono">{fmtMoney(r.amount)}</td>
                  <td className="left muted">{KIND_LABEL[r.kind]}</td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td className="left muted" colSpan={7}>
                    No charge or interest rows in the transaction log yet.
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
