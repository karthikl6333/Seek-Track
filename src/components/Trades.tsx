import { useMemo, useState } from 'react';
import type { Store } from '../hooks/useStore';
import { feeClass, fmtMoney, fmtQty } from '../lib/format';

type SortKey = 'date' | 'action' | 'symbol' | 'quantity' | 'price' | 'fees' | 'amount';

export function Trades({ store }: { store: Store }) {
  const [q, setQ] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [actionFilters, setActionFilters] = useState<Set<string>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<'all' | 'csv' | 'manual'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const allActions = useMemo(() => {
    const actions = new Set<string>();
    store.trades.forEach((t) => {
      if (t.action) actions.add(t.action);
    });
    return Array.from(actions).sort();
  }, [store.trades]);

  const toggleActionFilter = (action: string) => {
    setActionFilters((prev) => {
      const next = new Set(prev);
      if (next.has(action)) {
        next.delete(action);
      } else {
        next.add(action);
      }
      return next;
    });
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'date' ? 'desc' : 'asc');
    }
  };

  const sortMark = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const rows = useMemo(() => {
    // Filter out junk: TEST symbol and empty/whitespace-only symbols (wire/interest rows)
    let filtered = store.trades.filter(
      (t) => t.symbol.trim() !== '' && t.symbol.toUpperCase() !== 'TEST'
    );

    // Text filter
    const needle = q.trim().toUpperCase();
    if (needle) {
      filtered = filtered.filter(
        (t) =>
          t.symbol.includes(needle) ||
          t.action.toUpperCase().includes(needle) ||
          t.description.toUpperCase().includes(needle) ||
          (t.source ?? '').toUpperCase().includes(needle),
      );
    }

    // Date range filter
    if (dateFrom) {
      const fromTs = Date.parse(dateFrom);
      filtered = filtered.filter((t) => Date.parse(t.date) >= fromTs);
    }
    if (dateTo) {
      const toTs = Date.parse(dateTo);
      filtered = filtered.filter((t) => Date.parse(t.date) <= toTs);
    }

    // Action filter
    if (actionFilters.size > 0) {
      filtered = filtered.filter((t) => actionFilters.has(t.action));
    }

    // Source filter
    if (sourceFilter === 'csv') {
      filtered = filtered.filter((t) => (t.source ?? 'csv') === 'csv');
    } else if (sourceFilter === 'manual') {
      filtered = filtered.filter((t) => t.source === 'manual');
    }

    // Sort
    const dir = sortDir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      if (sortKey === 'date') {
        return ((Date.parse(a.date) || 0) - (Date.parse(b.date) || 0)) * dir;
      }
      if (sortKey === 'quantity' || sortKey === 'price' || sortKey === 'fees' || sortKey === 'amount') {
        return (a[sortKey] - b[sortKey]) * dir;
      }
      return String(a[sortKey]).localeCompare(String(b[sortKey])) * dir;
    });

    return filtered;
  }, [store.trades, q, dateFrom, dateTo, actionFilters, sourceFilter, sortKey, sortDir]);

  return (
    <div className="stack">
      <div className="card">
        <h3>Trade Blotter</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
          <div className="field" style={{ flex: '1 1 200px', minWidth: 200 }}>
            <label>Search</label>
            <input
              placeholder="Symbol, action, description…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: '0 1 140px' }}>
            <label>Date from</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: '0 1 140px' }}>
            <label>Date to</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: '0 1 120px' }}>
            <label>Source</label>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as 'all' | 'csv' | 'manual')}
            >
              <option value="all">All</option>
              <option value="csv">CSV</option>
              <option value="manual">Manual</option>
            </select>
          </div>
        </div>

        {allActions.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--muted)' }}>
              Filter by action:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allActions.map((action) => (
                <button
                  key={action}
                  type="button"
                  className={`btn small${actionFilters.has(action) ? '' : ' ghost'}`}
                  onClick={() => toggleActionFilter(action)}
                  style={{
                    minHeight: 28,
                    padding: '4px 10px',
                    fontSize: 12,
                  }}
                >
                  {action}
                </button>
              ))}
              {actionFilters.size > 0 && (
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => setActionFilters(new Set())}
                  style={{
                    minHeight: 28,
                    padding: '4px 10px',
                    fontSize: 12,
                    color: '#e67e22',
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
          Showing {rows.length} {rows.length === 1 ? 'trade' : 'trades'}
        </div>
      </div>

      <div className="card">
        <div className="table-wrap" style={{ maxHeight: 640 }}>
          <table className="data">
            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-elev)', zIndex: 1 }}>
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
                <th>
                  <button type="button" className="linkish" onClick={() => toggleSort('quantity')}>
                    Qty{sortMark('quantity')}
                  </button>
                </th>
                <th>
                  <button type="button" className="linkish" onClick={() => toggleSort('price')}>
                    Price{sortMark('price')}
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
                <th className="left">Source</th>
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
                <td className={feeClass(t.fees)}>{fmtMoney(t.fees)}</td>
                <td className="mono">{fmtMoney(t.amount)}</td>
                <td className="left muted">{t.source ?? 'csv'}</td>
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
                <td className="left muted" colSpan={9}>
                  No trades match the current filters. Try adjusting your search or date range.
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
