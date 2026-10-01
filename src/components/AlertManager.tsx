import { useCallback, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import type { PriceAlert } from '../types';
import { loadAlerts, createAlert, deleteAlert } from '../lib/db';
import { fmtMoney } from '../lib/format';

interface Props {
  compact?: boolean;
  openSymbols?: string[];
  watchlistSymbols?: string[];
}

export interface AlertManagerRef {
  refreshAlerts: () => Promise<void>;
}

export const AlertManager = forwardRef<AlertManagerRef, Props>(function AlertManager(
  { compact = false, openSymbols = [], watchlistSymbols = [] },
  ref
) {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add alert form state
  const [showForm, setShowForm] = useState(false);
  const [formSymbol, setFormSymbol] = useState('');
  const [formTargetPrice, setFormTargetPrice] = useState('');
  const [formCondition, setFormCondition] = useState<'above' | 'below'>('above');
  const [submitting, setSubmitting] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await loadAlerts();
      setAlerts(data.alerts);
    } catch (err) {
      console.error('[AlertManager] Failed to load alerts:', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAlerts();
  }, [fetchAlerts]);

  // Expose refresh method to parent
  useImperativeHandle(ref, () => ({
    refreshAlerts: fetchAlerts,
  }), [fetchAlerts]);

  const handleAddAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSymbol || !formTargetPrice) return;

    const targetPrice = Number(formTargetPrice);
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      alert('Invalid target price');
      return;
    }

    try {
      setSubmitting(true);
      await createAlert({
        symbol: formSymbol.trim().toUpperCase(),
        targetPrice,
        condition: formCondition,
      });

      // Reset form
      setFormSymbol('');
      setFormTargetPrice('');
      setFormCondition('above');
      setShowForm(false);

      // Refresh alerts
      await fetchAlerts();
    } catch (err) {
      console.error('[AlertManager] Failed to create alert:', err);
      alert(`Failed to create alert: ${String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAlert = async (id: string) => {
    if (!confirm('Delete this alert?')) return;

    try {
      await deleteAlert(id);
      await fetchAlerts();
    } catch (err) {
      console.error('[AlertManager] Failed to delete alert:', err);
      alert(`Failed to delete alert: ${String(err)}`);
    }
  };

  // Get suggested symbols (union of open positions + watchlist)
  const suggestedSymbols = Array.from(
    new Set([...openSymbols, ...watchlistSymbols])
  ).sort();

  return (
    <div className="card">
      <div className="row-actions" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Price Alerts</h3>
        <button
          type="button"
          className="btn small"
          onClick={() => setShowForm((v) => !v)}
          disabled={loading}
        >
          {showForm ? 'Cancel' : '+ Add alert'}
        </button>
      </div>

      {!compact && (
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          Get notified when a symbol reaches your target price. Alerts trigger once and evaluate on
          every price refresh.
        </p>
      )}

      {error && (
        <div
          style={{
            padding: 8,
            marginBottom: 8,
            background: 'var(--danger-bg, #ff000010)',
            color: 'var(--danger, #ff6b6b)',
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleAddAlert} style={{ marginBottom: 12 }}>
          <div className="grid-2" style={{ gap: 8 }}>
            <div className="field">
              <label>Symbol</label>
              <input
                type="text"
                value={formSymbol}
                onChange={(e) => setFormSymbol(e.target.value.toUpperCase())}
                placeholder="e.g. NVDA"
                required
                disabled={submitting}
                list="alert-symbol-suggestions"
              />
              {suggestedSymbols.length > 0 && (
                <datalist id="alert-symbol-suggestions">
                  {suggestedSymbols.map((sym) => (
                    <option key={sym} value={sym} />
                  ))}
                </datalist>
              )}
            </div>

            <div className="field">
              <label>Target Price</label>
              <input
                type="number"
                step="0.01"
                value={formTargetPrice}
                onChange={(e) => setFormTargetPrice(e.target.value)}
                placeholder="0.00"
                required
                disabled={submitting}
              />
            </div>

            <div className="field">
              <label>Condition</label>
              <select
                value={formCondition}
                onChange={(e) => setFormCondition(e.target.value as 'above' | 'below')}
                disabled={submitting}
              >
                <option value="above">Price crosses above</option>
                <option value="below">Price drops below</option>
              </select>
            </div>

            <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button
                type="submit"
                className="btn"
                disabled={submitting || !formSymbol || !formTargetPrice}
                style={{ width: '100%' }}
              >
                {submitting ? 'Adding...' : 'Add Alert'}
              </button>
            </div>
          </div>
        </form>
      )}

      {loading && alerts.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>Loading alerts...</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="left">Symbol</th>
                <th>Target</th>
                <th className="left">Condition</th>
                <th className="left">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => {
                const statusBadge =
                  alert.status === 'triggered' ? (
                    <span
                      className="badge"
                      style={{
                        background: 'var(--success-bg, #00ff0020)',
                        color: 'var(--success, #00ff00)',
                      }}
                    >
                      Triggered{' '}
                      {alert.lastPrice != null && `@ ${fmtMoney(alert.lastPrice, 4)}`}
                    </span>
                  ) : (
                    <span
                      className="badge"
                      style={{
                        background: 'var(--muted-bg, #ffffff10)',
                        color: 'var(--text-muted, #888)',
                      }}
                    >
                      Active
                    </span>
                  );

                const conditionText =
                  alert.condition === 'above' ? 'crosses above' : 'drops below';

                return (
                  <tr key={alert.id}>
                    <td className="left">
                      <span className="mono">{alert.symbol}</span>
                    </td>
                    <td className="mono">{fmtMoney(alert.targetPrice, 4)}</td>
                    <td className="left">{conditionText}</td>
                    <td className="left">{statusBadge}</td>
                    <td>
                      <div className="row-actions" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn small ghost"
                          onClick={() => handleDeleteAlert(alert.id)}
                          title="Delete alert"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {alerts.length === 0 && (
                <tr>
                  <td className="left muted" colSpan={5}>
                    No alerts configured. Click "+ Add alert" to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {alerts.length > 0 && (
        <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
          Active alerts: {alerts.filter((a) => a.status === 'active').length} · Triggered:{' '}
          {alerts.filter((a) => a.status === 'triggered').length}
        </p>
      )}
    </div>
  );
});
