import { useCallback, useEffect, useState } from 'react';
import { loadPaperSummary, refreshPaperData } from '../lib/db';
import type { PaperSummary } from '../types';
import { fmtMoney, fmtPct, fmtQty, moneyTone, pnlClass } from '../lib/format';

export function Paper() {
  const [summary, setSummary] = useState<PaperSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await loadPaperSummary();
      setSummary(data);
      setLastRefreshAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const refreshData = useCallback(async () => {
    setBusy(true);
    try {
      await fetchData();
    } finally {
      setBusy(false);
    }
  }, [fetchData]);

  const refreshLiveData = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await refreshPaperData();
      if (result.ok) {
        const data = await loadPaperSummary();
        setSummary(data);
        setLastRefreshAt(result.refreshedAt || new Date().toISOString());
      } else {
        setError(result.error || 'Refresh failed');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await fetchData();
        if (!cancelled) {
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchData]);

  if (loading) {
    return (
      <div className="stack">
        <p className="muted">Loading paper trading data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stack">
        <div className="caveat" role="alert">
          Failed to load paper trading data: {error}
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="stack">
        <p className="muted">No paper trading data available.</p>
      </div>
    );
  }

  const { state, positions, recentOrders, scoreboard } = summary;
  const statusBadgeClass =
    state.status === 'active'
      ? 'badge bull-badge'
      : state.status === 'review'
        ? 'badge bear-badge'
        : 'badge';

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const lastRefreshLabel = lastRefreshAt
    ? new Date(lastRefreshAt).toLocaleString(undefined, { timeZone: 'Asia/Kolkata' }) + ' IST'
    : null;

  return (
    <div className="stack">
      <div className="card">
        <div
          className="row-actions"
          style={{ justifyContent: 'space-between', marginBottom: 12 }}
        >
          <div>
            <h3 style={{ margin: 0, marginBottom: 4 }}>Alpaca Paper Trading Mandate</h3>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {state.strategyNote}
            </p>
            {lastRefreshLabel && (
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                Last refreshed: {lastRefreshLabel}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={() => void refreshData()}
              title="Refresh paper trading data from database"
            >
              {busy ? '…' : 'Refresh'}
            </button>
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={() => void refreshLiveData()}
              title="Refresh live P&L from Alpaca paper API"
            >
              {busy ? '…' : 'Live P&L'}
            </button>
            <span className={statusBadgeClass}>{state.status}</span>
          </div>
        </div>
        <div className="row-actions" style={{ gap: 12, justifyContent: 'flex-start' }}>
          <div>
            <span className="muted" style={{ fontSize: 12 }}>
              Period
            </span>
            <div style={{ fontSize: 13, marginTop: 2 }}>
              {formatDate(state.mandateStart)} – {formatDate(state.mandateEnd)}
            </div>
          </div>
          <div>
            <span className="muted" style={{ fontSize: 12 }}>
              Last Updated
            </span>
            <div style={{ fontSize: 13, marginTop: 2 }}>{formatTime(state.updatedAt)}</div>
          </div>
        </div>
      </div>

      <div className="grid-5">
        <div className="card">
          <h3>Equity</h3>
          <div className={`stat-value mono ${moneyTone('stat')}`}>{fmtMoney(state.equity)}</div>
          <div className="stat-label">Account value</div>
        </div>
        <div className="card">
          <h3>Cash</h3>
          <div className={`stat-value mono ${moneyTone('stat')}`}>{fmtMoney(state.cash)}</div>
          <div className="stat-label">Available cash</div>
        </div>
        <div className="card">
          <h3>Buying Power</h3>
          <div className={`stat-value mono ${moneyTone('stat')}`}>
            {fmtMoney(state.buyingPower)}
          </div>
          <div className="stat-label">Leverage capacity</div>
        </div>
        <div className="card">
          <h3>Day P&amp;L</h3>
          <div className={`stat-value ${pnlClass(state.dayPnl)} ${moneyTone('stat')}`}>
            {fmtMoney(state.dayPnl)}
          </div>
          <div className="stat-label">Today's change</div>
        </div>
        <div className="card">
          <h3>Week P&amp;L</h3>
          <div className={`stat-value ${pnlClass(state.weekPnl)} ${moneyTone('stat')}`}>
            {fmtMoney(state.weekPnl)}
          </div>
          <div className="stat-label">Mandate total</div>
        </div>
      </div>

      <div className="card">
        <h3>Open Paper Positions</h3>
        {positions.length === 0 ? (
          <p className="muted">No open positions yet. Trading agent will post updates here.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="left">Symbol</th>
                  <th>Qty</th>
                  <th>Avg Price</th>
                  <th>Mkt Value</th>
                  <th>Unrealized P&amp;L</th>
                  <th className="left">Theme</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => (
                  <tr key={pos.symbol}>
                    <td className="left mono">{pos.symbol}</td>
                    <td className="mono">{fmtQty(pos.quantity)}</td>
                    <td className="mono">{fmtMoney(pos.avgPrice, 4)}</td>
                    <td className={moneyTone('notional')}>{fmtMoney(pos.marketValue)}</td>
                    <td className={pnlClass(pos.unrealizedPnl)}>{fmtMoney(pos.unrealizedPnl)}</td>
                    <td className="left">{pos.theme || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Recent Orders &amp; Fills</h3>
        {recentOrders.length === 0 ? (
          <p className="muted">No orders yet. Trading agent will post updates here.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="left">Time</th>
                  <th className="left">Symbol</th>
                  <th>Side</th>
                  <th>Qty</th>
                  <th>Filled</th>
                  <th>Avg Fill</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => {
                  const statusBadge =
                    order.status === 'filled'
                      ? 'badge bull-badge'
                      : order.status === 'cancelled'
                        ? 'badge bear-badge'
                        : 'badge';
                  const sideClass =
                    order.side.toLowerCase() === 'buy'
                      ? 'bull-badge'
                      : order.side.toLowerCase() === 'sell'
                        ? 'bear-badge'
                        : '';

                  return (
                    <tr key={order.id}>
                      <td className="left mono" style={{ fontSize: 12 }}>
                        {formatTime(order.createdAt)}
                      </td>
                      <td className="left mono">{order.symbol}</td>
                      <td>
                        <span className={`badge ${sideClass}`}>{order.side}</span>
                      </td>
                      <td className="mono">{fmtQty(order.quantity)}</td>
                      <td className="mono">{fmtQty(order.filledQty)}</td>
                      <td className="mono">{fmtMoney(order.avgFillPrice, 4)}</td>
                      <td>
                        <span className={statusBadge}>{order.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Week Scoreboard</h3>
        <div className="grid-3">
          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              Total P&amp;L
            </div>
            <div className={`${pnlClass(scoreboard.totalPnl)} mono`} style={{ fontSize: 18 }}>
              {fmtMoney(scoreboard.totalPnl)}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              Trade Count
            </div>
            <div className="mono" style={{ fontSize: 18 }}>
              {scoreboard.tradeCount}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              Win Rate
            </div>
            <div className="mono" style={{ fontSize: 18 }}>
              {scoreboard.winRate !== null ? fmtPct(scoreboard.winRate) : '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
