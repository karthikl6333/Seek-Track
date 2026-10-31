import { useCallback, useEffect, useState } from 'react';
import type { PlanRule, PlanRuleType, SymbolPosition } from '../../types/index';
import { loadPlanRules, createPlanRule, updatePlanRule, deletePlanRule } from '../../api/client';
import { fmtMoney, fmtPct } from '../../lib/format';

interface Props {
  positions: SymbolPosition[];
  marks: Record<string, number>;
  compact?: boolean;
}

interface RuleWithPrice extends PlanRule {
  lastPrice: number | null;
  avgCost: number | null;
  distancePct: number | null;
  distanceDollar: number | null;
  daysUntilDeadline: number | null;
  status: 'normal' | 'near' | 'hit';
}

function calculateDaysUntil(deadlineDate: string): number {
  const now = new Date();
  const deadline = new Date(deadlineDate);
  const diffMs = deadline.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function calculateDistance(
  ruleType: PlanRuleType,
  priceLevel: number | null,
  lastPrice: number | null,
): { pct: number | null; dollar: number | null; status: 'normal' | 'near' | 'hit' } {
  if (!priceLevel || !lastPrice) {
    return { pct: null, dollar: null, status: 'normal' };
  }

  const distancePct = ((lastPrice - priceLevel) / priceLevel) * 100;
  const distanceDollar = lastPrice - priceLevel;

  // Near threshold: 3% (configurable in future)
  const nearThreshold = 3;

  let status: 'normal' | 'near' | 'hit' = 'normal';

  if (ruleType === 'target') {
    // Target: approaching from below
    if (lastPrice >= priceLevel) {
      status = 'hit';
    } else if (distancePct > -nearThreshold) {
      status = 'near';
    }
  } else if (ruleType === 'stop' || ruleType === 'no-add-below') {
    // Stop/no-add: approaching from above
    if (lastPrice <= priceLevel) {
      status = 'hit';
    } else if (distancePct < nearThreshold) {
      status = 'near';
    }
  }

  return { pct: distancePct, dollar: distanceDollar, status };
}

export function PlanVsPrice({ positions, marks, compact = false }: Props) {
  const [rules, setRules] = useState<PlanRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formSymbol, setFormSymbol] = useState('');
  const [formRuleType, setFormRuleType] = useState<PlanRuleType>('target');
  const [formPriceLevel, setFormPriceLevel] = useState('');
  const [formDeadlineDate, setFormDeadlineDate] = useState('');
  const [formNote, setFormNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPriceLevel, setEditPriceLevel] = useState('');
  const [editDeadlineDate, setEditDeadlineDate] = useState('');
  const [editNote, setEditNote] = useState('');

  const fetchRules = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await loadPlanRules('real');
      setRules(data.rules);
    } catch (err) {
      console.error('[PlanVsPrice] Failed to load rules:', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRules();
  }, [fetchRules]);

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSymbol || !formRuleType) return;

    try {
      setSubmitting(true);
      await createPlanRule({
        symbol: formSymbol.trim().toUpperCase(),
        account: 'real',
        ruleType: formRuleType,
        priceLevel: formPriceLevel ? Number(formPriceLevel) : null,
        deadlineDate: formDeadlineDate || null,
        note: formNote || null,
      });

      // Reset form
      setFormSymbol('');
      setFormRuleType('target');
      setFormPriceLevel('');
      setFormDeadlineDate('');
      setFormNote('');
      setShowForm(false);

      await fetchRules();
    } catch (err) {
      console.error('[PlanVsPrice] Failed to create rule:', err);
      alert(`Failed to create rule: ${String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (rule: PlanRule) => {
    setEditingId(rule.id);
    setEditPriceLevel(rule.priceLevel?.toString() ?? '');
    setEditDeadlineDate(rule.deadlineDate ?? '');
    setEditNote(rule.note ?? '');
  };

  const handleSaveEdit = async (id: string) => {
    try {
      await updatePlanRule(id, {
        priceLevel: editPriceLevel ? Number(editPriceLevel) : null,
        deadlineDate: editDeadlineDate || null,
        note: editNote || null,
      });
      setEditingId(null);
      await fetchRules();
    } catch (err) {
      console.error('[PlanVsPrice] Failed to update rule:', err);
      alert(`Failed to update rule: ${String(err)}`);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditPriceLevel('');
    setEditDeadlineDate('');
    setEditNote('');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this rule?')) return;

    try {
      await deletePlanRule(id);
      await fetchRules();
    } catch (err) {
      console.error('[PlanVsPrice] Failed to delete rule:', err);
      alert(`Failed to delete rule: ${String(err)}`);
    }
  };

  // Enrich rules with current prices and calculations
  const enrichedRules: RuleWithPrice[] = rules.map((rule) => {
    const lastPrice = marks[rule.symbol] ?? null;
    const position = positions.find((p) => p.symbol === rule.symbol);
    const avgCost = position?.avgCost ?? null;

    const { pct, dollar, status } = calculateDistance(
      rule.ruleType,
      rule.priceLevel,
      lastPrice,
    );

    const daysUntilDeadline =
      rule.deadlineDate ? calculateDaysUntil(rule.deadlineDate) : null;

    return {
      ...rule,
      lastPrice,
      avgCost,
      distancePct: pct,
      distanceDollar: dollar,
      daysUntilDeadline,
      status,
    };
  });

  // Group by symbol
  const bySymbol = new Map<string, RuleWithPrice[]>();
  for (const rule of enrichedRules) {
    const existing = bySymbol.get(rule.symbol) ?? [];
    existing.push(rule);
    bySymbol.set(rule.symbol, existing);
  }

  const holdingSymbols = positions.map((p) => p.symbol);

  return (
    <div className="card">
      <div className="row-actions" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Plan vs Price</h3>
        <button
          type="button"
          className="btn small"
          onClick={() => setShowForm((v) => !v)}
          disabled={loading}
        >
          {showForm ? 'Cancel' : '+ Add rule'}
        </button>
      </div>

      {!compact && (
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          Track your exit targets, stops, and deadlines. Rules show distance from current price.
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
        <form onSubmit={handleAddRule} style={{ marginBottom: 12 }}>
          <div className="grid-2" style={{ gap: 8 }}>
            <div className="field">
              <label>Symbol</label>
              <input
                type="text"
                value={formSymbol}
                onChange={(e) => setFormSymbol(e.target.value.toUpperCase())}
                placeholder="e.g. SOXL"
                required
                disabled={submitting}
                list="plan-symbol-suggestions"
              />
              {holdingSymbols.length > 0 && (
                <datalist id="plan-symbol-suggestions">
                  {holdingSymbols.map((sym) => (
                    <option key={sym} value={sym} />
                  ))}
                </datalist>
              )}
            </div>

            <div className="field">
              <label>Rule Type</label>
              <select
                value={formRuleType}
                onChange={(e) => setFormRuleType(e.target.value as PlanRuleType)}
                disabled={submitting}
              >
                <option value="target">Target (sell)</option>
                <option value="stop">Stop</option>
                <option value="no-add-below">No-add-below</option>
                <option value="deadline">Deadline</option>
                <option value="note">Note only</option>
              </select>
            </div>

            {['target', 'stop', 'no-add-below'].includes(formRuleType) && (
              <div className="field">
                <label>Price Level</label>
                <input
                  type="number"
                  step="0.01"
                  value={formPriceLevel}
                  onChange={(e) => setFormPriceLevel(e.target.value)}
                  placeholder="0.00"
                  required
                  disabled={submitting}
                />
              </div>
            )}

            {formRuleType === 'deadline' && (
              <div className="field">
                <label>Deadline Date</label>
                <input
                  type="date"
                  value={formDeadlineDate}
                  onChange={(e) => setFormDeadlineDate(e.target.value)}
                  required
                  disabled={submitting}
                />
              </div>
            )}

            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Note (optional)</label>
              <input
                type="text"
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                placeholder="e.g. don't rebuy before Nov 4"
                disabled={submitting}
              />
            </div>

            <div className="field" style={{ display: 'flex', alignItems: 'flex-end', gridColumn: '1 / -1' }}>
              <button
                type="submit"
                className="btn"
                disabled={submitting}
                style={{ width: '100%' }}
              >
                {submitting ? 'Adding...' : 'Add Rule'}
              </button>
            </div>
          </div>
        </form>
      )}

      {loading && rules.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>Loading rules...</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data" style={{ fontSize: compact ? 12 : 13 }}>
            <thead>
              <tr>
                <th className="left">Symbol</th>
                <th className="left">Rule</th>
                <th>Level / Date</th>
                <th>Last</th>
                <th>Avg Cost</th>
                <th>Distance</th>
                <th className="left">Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {Array.from(bySymbol.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([symbol, symbolRules]) =>
                  symbolRules.map((rule, idx) => {
                    const isEditing = editingId === rule.id;
                    const showAvgCost = idx === 0 && rule.avgCost !== null;

                    return (
                      <tr key={rule.id} style={{ 
                        background: rule.status === 'hit' 
                          ? 'rgba(239, 68, 68, 0.1)' 
                          : rule.status === 'near' 
                          ? 'rgba(234, 179, 8, 0.1)' 
                          : undefined 
                      }}>
                        <td className="left">
                          {idx === 0 && <span className="mono">{symbol}</span>}
                        </td>
                        <td className="left">
                          <span
                            style={{
                              fontSize: 11,
                              padding: '2px 6px',
                              borderRadius: 3,
                              background:
                                rule.ruleType === 'target'
                                  ? 'rgba(34, 197, 94, 0.15)'
                                  : rule.ruleType === 'stop'
                                  ? 'rgba(239, 68, 68, 0.15)'
                                  : rule.ruleType === 'deadline'
                                  ? 'rgba(59, 130, 246, 0.15)'
                                  : 'rgba(156, 163, 175, 0.15)',
                              color:
                                rule.ruleType === 'target'
                                  ? '#22c55e'
                                  : rule.ruleType === 'stop'
                                  ? '#ef4444'
                                  : rule.ruleType === 'deadline'
                                  ? '#3b82f6'
                                  : '#9ca3af',
                              textTransform: 'uppercase',
                            }}
                          >
                            {rule.ruleType}
                          </span>
                        </td>
                        <td className="mono">
                          {isEditing ? (
                            rule.ruleType === 'deadline' ? (
                              <input
                                type="date"
                                value={editDeadlineDate}
                                onChange={(e) => setEditDeadlineDate(e.target.value)}
                                style={{ width: 120, fontSize: 12 }}
                              />
                            ) : (
                              <input
                                type="number"
                                step="0.01"
                                value={editPriceLevel}
                                onChange={(e) => setEditPriceLevel(e.target.value)}
                                style={{ width: 80, fontSize: 12 }}
                              />
                            )
                          ) : rule.ruleType === 'deadline' ? (
                            rule.deadlineDate ? (
                              <span>
                                {new Date(rule.deadlineDate).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                                {rule.daysUntilDeadline !== null && (
                                  <span
                                    className="muted"
                                    style={{ display: 'block', fontSize: 10 }}
                                  >
                                    {rule.daysUntilDeadline === 0
                                      ? 'today'
                                      : rule.daysUntilDeadline === 1
                                      ? 'tomorrow'
                                      : rule.daysUntilDeadline < 0
                                      ? `${-rule.daysUntilDeadline}d ago`
                                      : `${rule.daysUntilDeadline}d`}
                                  </span>
                                )}
                              </span>
                            ) : (
                              '—'
                            )
                          ) : rule.priceLevel ? (
                            fmtMoney(rule.priceLevel, 2)
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="mono">
                          {rule.lastPrice ? fmtMoney(rule.lastPrice, 2) : '—'}
                        </td>
                        <td className="mono">
                          {showAvgCost && rule.avgCost ? fmtMoney(rule.avgCost, 2) : ''}
                        </td>
                        <td>
                          {rule.distancePct !== null && rule.ruleType !== 'deadline' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span
                                className="mono"
                                style={{
                                  fontSize: 11,
                                  color:
                                    rule.status === 'hit'
                                      ? '#ef4444'
                                      : rule.status === 'near'
                                      ? '#eab308'
                                      : undefined,
                                }}
                              >
                                {fmtPct(rule.distancePct)}
                              </span>
                              {rule.distanceDollar !== null && (
                                <span className="muted" style={{ fontSize: 10 }}>
                                  ({rule.distanceDollar >= 0 ? '+' : ''}
                                  {fmtMoney(rule.distanceDollar, 2)})
                                </span>
                              )}
                              {rule.status !== 'normal' && (
                                <span style={{ marginLeft: 4 }}>
                                  {rule.status === 'hit' ? '🔴' : '🟡'}
                                </span>
                              )}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="left">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editNote}
                              onChange={(e) => setEditNote(e.target.value)}
                              style={{ width: '100%', fontSize: 11 }}
                              placeholder="Note"
                            />
                          ) : rule.note ? (
                            <span style={{ fontSize: 11 }}>{rule.note}</span>
                          ) : (
                            ''
                          )}
                        </td>
                        <td>
                          <div
                            className="row-actions"
                            style={{ gap: 4, justifyContent: 'flex-end' }}
                          >
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  className="btn small"
                                  onClick={() => handleSaveEdit(rule.id)}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="btn small ghost"
                                  onClick={handleCancelEdit}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="btn small"
                                  onClick={() => handleEdit(rule)}
                                  title="Edit rule"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="btn small ghost"
                                  onClick={() => handleDelete(rule.id)}
                                  title="Delete rule"
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }),
                )}
              {rules.length === 0 && (
                <tr>
                  <td className="left muted" colSpan={8}>
                    No rules configured. Click "+ Add rule" to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {rules.length > 0 && (
        <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
          Active rules: {rules.length} · 🟡 Near (within 3%) · 🔴 Hit
        </p>
      )}
    </div>
  );
}
