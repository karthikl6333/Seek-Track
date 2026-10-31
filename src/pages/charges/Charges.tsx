import { useMemo, useState } from 'react';
import { FilterChips } from '../../components/FilterChips';
import type { Store } from '../../hooks/useStore';
import {
  CHARGE_KIND_LABEL,
  chargeKindCounts,
  filterChargeRows,
  listChargeRows,
  summarizeCharges,
  totalChargeRows,
  type ChargeKind,
} from '../../lib/charges';
import { feeClass, fmtMoney, moneyTone } from '../../lib/format';

const KIND_LABEL = CHARGE_KIND_LABEL;

type SortKey = 'date' | 'action' | 'symbol' | 'description' | 'fees' | 'amount' | 'kind';

export function Charges({ store }: { store: Store }) {
  const summary = useMemo(() => summarizeCharges(store.trades), [store.trades]);
  const rows = useMemo(() => listChargeRows(store.trades), [store.trades]);
  const [selected, setSelected] = useState<Set<ChargeKind>>(() => new Set());
  const kindCounts = useMemo(() => chargeKindCounts(rows), [rows]);
  // Drop selections for kinds that vanished from the data (e.g. after a re-import).
  const activeKinds = useMemo(() => {
    const present = new Set(kindCounts.map((k) => k.kind));
    return new Set([...selected].filter((k) => present.has(k)));
  }, [selected, kindCounts]);
  const filtered = useMemo(() => filterChargeRows(rows, activeKinds), [rows, activeKinds]);
  const totals = useMemo(() => totalChargeRows(filtered), [filtered]);
  const toggleKind = (k: ChargeKind) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const copy = [...filtered];
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
  }, [filtered, sortKey, sortDir]);

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
          <div className="stat-label">
            Fees + margin − dividends (excl. AVGO)
          </div>
        </div>
        <div className="card">
          <h3>Fees</h3>
          <div className={`stat-value ${moneyTone('fee')}`}>{fmtMoney(summary.fees)}</div>
          <div className="stat-label">Fees, commissions, taxes</div>
        </div>
        <div className="card">
          <h3>Margin interest</h3>
          <div className={`stat-value ${moneyTone('fee')}`}>{fmtMoney(summary.marginInterest)}</div>
          <div className="stat-label">Debit interest</div>
        </div>
        <div className="card">
          <h3>Dividend income</h3>
          <div className={`stat-value ${moneyTone('stat')}`}>{fmtMoney(summary.dividendIncome)}</div>
          <div className="stat-label">After-tax (excl. AVGO)</div>
        </div>
      </div>

      <div className="card">
        <h3>Charge &amp; interest rows</h3>
        <FilterChips
          ariaLabel="Filter by charge type"
          options={kindCounts.map(({ kind, count }) => ({ key: kind, label: KIND_LABEL[kind], count }))}
          active={activeKinds}
          totalCount={rows.length}
          onToggle={toggleKind}
          onClear={() => setSelected(new Set())}
        />
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
                    {rows.length === 0
                      ? 'No charge or interest rows in the transaction log yet.'
                      : 'No rows match the selected charge types.'}
                  </td>
                </tr>
              )}
            </tbody>
            {sorted.length > 0 && (
              <tfoot>
                <tr className="totals-row">
                  <td className="left" colSpan={4}>
                    Total · {totals.count} {totals.count === 1 ? 'row' : 'rows'}
                    {activeKinds.size > 0 ? ' (filtered)' : ''}
                  </td>
                  <td className={feeClass(totals.fees)}>{fmtMoney(totals.fees)}</td>
                  <td className="mono">{fmtMoney(totals.amount)}</td>
                  <td className="left muted">Σ fees / amount</td>
                </tr>
                <tr className="totals-row">
                  <td className="left" colSpan={4}>
                    Net charge (costs {fmtMoney(totals.debits)} − credits {fmtMoney(totals.credits)})
                  </td>
                  <td />
                  <td className={totals.netCharge > 0 ? 'mono hl-fee' : totals.netCharge < 0 ? 'mono pos' : 'mono'}>
                    {fmtMoney(totals.netCharge)}
                  </td>
                  <td className="left muted">{totals.netCharge < 0 ? 'net credit' : 'net cost'}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
