import { useMemo, useState } from 'react';
import type { Store } from '../hooks/useStore';
import { fmtMoney, fmtPct, pnlClass } from '../lib/format';
import { TickerLink } from '../lib/yahoo';

interface ResearchProProps {
  store: Store;
}

interface OpenSwingCard {
  symbol: string;
  theme: string;
  underlying: string | null;
  factor: number | null;
  daysHeld: number;
  avgCost: number;
  lastMark: number | null;
  unrealizedPnl: number | null;
  quantity: number;
  notional: number;
  firstDate: string;
}

interface ThemeExposure {
  underlying: string;
  netDirection: 'long' | 'short' | 'mixed';
  netNotional: number;
  hasConflict: boolean;
  positions: Array<{
    symbol: string;
    factor: number | null;
    notional: number;
    direction: 'long' | 'short';
  }>;
}

interface ClosedSwing {
  symbol: string;
  holdDays: number;
  entryToExitPct: number;
  realizedPnl: number;
  exitDate: string;
}

interface LeveragedHoldRisk {
  symbol: string;
  factor: number;
  daysHeld: number;
  avgCost: number;
  quantity: number;
  warningLevel: 'low' | 'medium' | 'high';
}

function daysBetween(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function ResearchPro({ store }: ResearchProProps) {
  const [localTargets, setLocalTargets] = useState<Record<string, { target: string; stop: string }>>({});

  const openSwings = useMemo((): OpenSwingCard[] => {
    if (!store.analysis) return [];
    const cards: OpenSwingCard[] = [];
    const pairs = store.settings?.pairs ?? [];

    for (const pos of store.analysis.positions) {
      if (pos.quantity === 0) continue;
      const pair = pairs.find((p) => p.etf.toUpperCase() === pos.symbol.toUpperCase());
      const underlying = pair?.underlying ?? null;
      const factor = pair?.factor ?? null;

      const firstLot = pos.openLots.length > 0 ? pos.openLots[0] : null;
      const firstDate = firstLot?.openDate ?? '';
      const daysHeld = firstDate ? daysBetween(firstDate) : 0;

      const notional = pos.markPrice !== null ? Math.abs(pos.quantity * pos.markPrice) : Math.abs(pos.quantity * pos.avgCost);

      cards.push({
        symbol: pos.symbol,
        theme: pos.theme,
        underlying,
        factor,
        daysHeld,
        avgCost: pos.avgCost,
        lastMark: pos.markPrice,
        unrealizedPnl: pos.unrealizedPnl,
        quantity: pos.quantity,
        notional,
        firstDate,
      });
    }

    cards.sort((a, b) => b.notional - a.notional);
    return cards;
  }, [store.analysis, store.settings]);

  const themeExposure = useMemo((): ThemeExposure[] => {
    if (!store.analysis) return [];
    const pairs = store.settings?.pairs ?? [];
    const byUnderlying = new Map<string, ThemeExposure>();

    for (const pos of store.analysis.positions) {
      if (pos.quantity === 0) continue;
      const pair = pairs.find((p) => p.etf.toUpperCase() === pos.symbol.toUpperCase());
      if (!pair) continue;

      const underlying = pair.underlying.toUpperCase();
      const notional = pos.markPrice !== null ? pos.quantity * pos.markPrice : pos.quantity * pos.avgCost;
      const direction: 'long' | 'short' = pos.quantity > 0 ? 'long' : 'short';

      if (!byUnderlying.has(underlying)) {
        byUnderlying.set(underlying, {
          underlying,
          netDirection: 'long',
          netNotional: 0,
          hasConflict: false,
          positions: [],
        });
      }

      const theme = byUnderlying.get(underlying)!;
      theme.positions.push({ symbol: pos.symbol, factor: pair.factor, notional, direction });
    }

    for (const theme of byUnderlying.values()) {
      const netNotional = theme.positions.reduce((s, p) => s + p.notional, 0);
      theme.netNotional = netNotional;
      theme.netDirection = netNotional > 0 ? 'long' : netNotional < 0 ? 'short' : 'mixed';

      const hasLong = theme.positions.some((p) => p.notional > 0);
      const hasShort = theme.positions.some((p) => p.notional < 0);
      theme.hasConflict = hasLong && hasShort;
    }

    return Array.from(byUnderlying.values()).sort((a, b) => Math.abs(b.netNotional) - Math.abs(a.netNotional));
  }, [store.analysis, store.settings]);

  const closedSwings = useMemo((): ClosedSwing[] => {
    const swings: ClosedSwing[] = [];
    const bySymbol = new Map<string, typeof store.trades>();

    for (const t of store.trades) {
      if (!t.symbol) continue;
      const list = bySymbol.get(t.symbol) ?? [];
      list.push(t);
      bySymbol.set(t.symbol, list);
    }

    for (const [symbol, trades] of bySymbol) {
      const sorted = [...trades].sort((a, b) => {
        const da = new Date(a.date).getTime();
        const db = new Date(b.date).getTime();
        if (da !== db) return da - db;
        return a.importedAt.localeCompare(b.importedAt);
      });

      const lots: Array<{ qty: number; price: number; date: string }> = [];
      for (const t of sorted) {
        const isBuy = /buy/i.test(t.action) && !/cover/i.test(t.action);
        const isSell = /sell/i.test(t.action) && !/short/i.test(t.action);
        if (!isBuy && !isSell) continue;

        if (isBuy) {
          lots.push({ qty: Math.abs(t.quantity), price: t.price, date: t.date });
        } else if (isSell && lots.length > 0) {
          let remaining = Math.abs(t.quantity);
          const exitPrice = t.price;
          const exitDate = t.date;

          while (remaining > 0 && lots.length > 0) {
            const lot = lots[0];
            const take = Math.min(lot.qty, remaining);
            const entryToExitPct = ((exitPrice - lot.price) / lot.price) * 100;
            const realizedPnl = take * (exitPrice - lot.price) - (t.fees / Math.abs(t.quantity)) * take;
            const holdDays = daysBetween(lot.date);

            if (holdDays >= 1) {
              swings.push({ symbol, holdDays, entryToExitPct, realizedPnl, exitDate });
            }

            lot.qty -= take;
            remaining -= take;
            if (lot.qty <= 0) lots.shift();
          }
        }
      }
    }

    return swings
      .filter((s) => s.holdDays > 0)
      .sort((a, b) => b.realizedPnl - a.realizedPnl)
      .slice(0, 20);
  }, [store.trades]);

  const leveragedRisks = useMemo((): LeveragedHoldRisk[] => {
    if (!store.analysis) return [];
    const risks: LeveragedHoldRisk[] = [];
    const pairs = store.settings?.pairs ?? [];

    for (const pos of store.analysis.positions) {
      if (pos.quantity === 0) continue;
      const pair = pairs.find((p) => p.etf.toUpperCase() === pos.symbol.toUpperCase());
      if (!pair) continue;
      const absFactor = Math.abs(pair.factor);
      if (absFactor < 2) continue;

      const firstLot = pos.openLots[0];
      if (!firstLot) continue;
      const daysHeld = daysBetween(firstLot.openDate);

      let warningLevel: 'low' | 'medium' | 'high' = 'low';
      if (daysHeld > 10) warningLevel = 'high';
      else if (daysHeld > 5) warningLevel = 'medium';

      risks.push({
        symbol: pos.symbol,
        factor: pair.factor,
        daysHeld,
        avgCost: pos.avgCost,
        quantity: pos.quantity,
        warningLevel,
      });
    }

    return risks.sort((a, b) => b.daysHeld - a.daysHeld);
  }, [store.analysis, store.settings]);

  const handleTargetChange = (symbol: string, field: 'target' | 'stop', value: string) => {
    setLocalTargets((prev) => ({
      ...prev,
      [symbol]: { ...(prev[symbol] ?? { target: '', stop: '' }), [field]: value },
    }));
  };

  const swingPlaybook = [
    {
      title: 'SanDisk / Memory family',
      tickers: ['SNDK', 'SNDQ'],
      notes: '2× short SanDisk (SNDQ) for pullback plays; watch memory-sector headlines',
    },
    {
      title: 'Micron flips',
      tickers: ['MU', 'MULL', 'MUZ'],
      notes: 'Rotate MULL (+2× long) ↔ MUZ (−2× short) around earnings & semis sentiment',
    },
    {
      title: 'Broadcom AVL',
      tickers: ['AVGO', 'AVL'],
      notes: 'AVL (+2× AVGO) on AI/networking strength; consider risk window around events',
    },
    {
      title: 'Palantir PLTZ mean-reversion',
      tickers: ['PLTR', 'PLTZ'],
      notes: 'PLTZ (−2× PLTR) for short-side rip fades; high vol / momentum name',
    },
    {
      title: 'Semis & Mega-cap 3× reference',
      tickers: ['SOXL', 'SOXS', 'TECL', 'TECS', 'TQQQ', 'SQQQ', 'FNGU', 'FNGD'],
      notes: 'Index 3× tools for research only; extreme daily reset & path dependency',
    },
  ];

  const swingHeuristics = [
    'Check theme conflicts before adding new positions — avoid accidental hedges',
    'Multi-day 2× holds risk path decay in choppy markets; have a directional thesis',
    'Avoid holding 2× through multi-day catalysts (earnings, Fed) without conviction',
    '3× products are for intraday/tactical; multi-day holds amplify decay risk significantly',
    'Review open-swing days regularly; trim winners proactively; cut losers at plan',
  ];

  return (
    <div className="stack">
      {openSwings.length > 0 && (
        <div className="card">
          <h3>Open swing positions · {openSwings.length} active</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="left">Symbol</th>
                  <th className="left">Theme / Underlying</th>
                  <th>Factor</th>
                  <th>Days held</th>
                  <th>Qty</th>
                  <th>Avg cost</th>
                  <th>Last</th>
                  <th>Unrealized P&L</th>
                  <th>Notional</th>
                  <th className="left">Target</th>
                  <th className="left">Stop</th>
                </tr>
              </thead>
              <tbody>
                {openSwings.map((s) => {
                  const local = localTargets[s.symbol] ?? { target: '', stop: '' };
                  return (
                    <tr key={s.symbol}>
                      <td className="left">
                        <TickerLink symbol={s.symbol} />
                      </td>
                      <td className="left">
                        <span className="muted" style={{ fontSize: 11 }}>
                          {s.theme}
                        </span>
                        {s.underlying && (
                          <div className="mono" style={{ fontSize: 11 }}>
                            {s.underlying}
                          </div>
                        )}
                      </td>
                      <td className="mono">{s.factor !== null ? `${s.factor > 0 ? '+' : ''}${s.factor}×` : '—'}</td>
                      <td className="mono">{s.daysHeld}</td>
                      <td className={`mono ${s.quantity > 0 ? 'pos' : 'neg'}`}>{s.quantity > 0 ? `+${s.quantity}` : s.quantity}</td>
                      <td className="mono">{fmtMoney(s.avgCost)}</td>
                      <td className="mono">{fmtMoney(s.lastMark)}</td>
                      <td className={pnlClass(s.unrealizedPnl)}>{fmtMoney(s.unrealizedPnl)}</td>
                      <td className="mono">{fmtMoney(s.notional)}</td>
                      <td className="left">
                        <input
                          type="text"
                          placeholder="—"
                          value={local.target}
                          onChange={(e) => handleTargetChange(s.symbol, 'target', e.target.value)}
                          style={{ width: 70, padding: '2px 6px', fontSize: 12, background: '#070b11', border: '1px solid #1a2230', borderRadius: 4, color: 'inherit' }}
                        />
                      </td>
                      <td className="left">
                        <input
                          type="text"
                          placeholder="—"
                          value={local.stop}
                          onChange={(e) => handleTargetChange(s.symbol, 'stop', e.target.value)}
                          style={{ width: 70, padding: '2px 6px', fontSize: 12, background: '#070b11', border: '1px solid #1a2230', borderRadius: 4, color: 'inherit' }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 11 }}>
            Target/stop fields stored in browser (localStorage) — optional planning aid; not persisted to DB.
          </p>
        </div>
      )}

      {themeExposure.length > 0 && (
        <div className="card">
          <h3>Theme exposure map · {themeExposure.length} underlyings</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="left">Underlying</th>
                  <th>Net direction</th>
                  <th>Net notional</th>
                  <th className="left">Positions</th>
                  <th className="left">Conflict?</th>
                </tr>
              </thead>
              <tbody>
                {themeExposure.map((t) => (
                  <tr key={t.underlying}>
                    <td className="left mono">{t.underlying}</td>
                    <td>
                      <span className={t.netDirection === 'long' ? 'badge bull-badge' : t.netDirection === 'short' ? 'badge bear-badge' : 'badge'}>
                        {t.netDirection === 'long' ? 'Long' : t.netDirection === 'short' ? 'Short' : 'Mixed'}
                      </span>
                    </td>
                    <td className={`mono ${t.netNotional > 0 ? 'pos' : t.netNotional < 0 ? 'neg' : ''}`}>{fmtMoney(t.netNotional)}</td>
                    <td className="left">
                      {t.positions.map((p, i) => (
                        <span key={i} className="mono" style={{ fontSize: 11, marginRight: 6 }}>
                          {p.symbol} ({p.factor !== null ? `${p.factor > 0 ? '+' : ''}${p.factor}×` : '—'})
                        </span>
                      ))}
                    </td>
                    <td className="left">
                      {t.hasConflict && (
                        <span className="badge" style={{ background: 'rgba(230,180,80,0.12)', color: '#e6b450', border: '1px solid rgba(230,180,80,0.28)' }}>
                          ⚠️ Long + Short
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 11 }}>
            Aggregates open exposure by underlying; flags conflicting long+short 2× positions in same theme.
          </p>
        </div>
      )}

      {leveragedRisks.length > 0 && (
        <div className="card">
          <h3>Leveraged-hold risk strip · 2×/3× open positions</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="left">Symbol</th>
                  <th>Factor</th>
                  <th>Days held</th>
                  <th>Avg cost</th>
                  <th>Qty</th>
                  <th className="left">Risk note</th>
                </tr>
              </thead>
              <tbody>
                {leveragedRisks.map((r) => (
                  <tr key={r.symbol}>
                    <td className="left mono">{r.symbol}</td>
                    <td className="mono">{r.factor > 0 ? '+' : ''}{r.factor}×</td>
                    <td className="mono">{r.daysHeld}</td>
                    <td className="mono">{fmtMoney(r.avgCost)}</td>
                    <td className={`mono ${r.quantity > 0 ? 'pos' : 'neg'}`}>{r.quantity > 0 ? `+${r.quantity}` : r.quantity}</td>
                    <td className="left">
                      {r.warningLevel === 'high' && (
                        <span className="muted" style={{ fontSize: 11, color: '#f07178' }}>
                          Long multi-day hold — watch path decay
                        </span>
                      )}
                      {r.warningLevel === 'medium' && (
                        <span className="muted" style={{ fontSize: 11, color: '#e6b450' }}>
                          Multi-day hold — monitor closely
                        </span>
                      )}
                      {r.warningLevel === 'low' && (
                        <span className="muted" style={{ fontSize: 11 }}>
                          Recent entry
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 11 }}>
            Daily-reset 2×/3× products risk path dependency on multi-day holds; soft warnings as hold length grows.
          </p>
        </div>
      )}

      {closedSwings.length > 0 && (
        <div className="card">
          <h3>Closed-swing scoreboard · top {closedSwings.length} multi-day rounds</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="left">Symbol</th>
                  <th>Hold days</th>
                  <th>Entry → Exit %</th>
                  <th>Realized P&L</th>
                  <th className="left">Exit date</th>
                </tr>
              </thead>
              <tbody>
                {closedSwings.map((c, i) => (
                  <tr key={i}>
                    <td className="left mono">{c.symbol}</td>
                    <td className="mono">{c.holdDays}</td>
                    <td className={pnlClass(c.entryToExitPct)}>{fmtPct(c.entryToExitPct)}</td>
                    <td className={pnlClass(c.realizedPnl)}>{fmtMoney(c.realizedPnl)}</td>
                    <td className="left muted" style={{ fontSize: 11 }}>
                      {new Date(c.exitDate).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 11 }}>
            Derived from closed FIFO rounds with hold ≥ 1 day; sorted by realized P&L descending.
          </p>
        </div>
      )}

      <div className="card">
        <h3>Swing playbook · core themes & tickers</h3>
        <div className="grid-2">
          {swingPlaybook.map((p, i) => (
            <div
              key={i}
              style={{
                padding: '12px 14px',
                border: '1px solid #1a2230',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.02)',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{p.title}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {p.tickers.map((t) => (
                  <TickerLink key={t} symbol={t} />
                ))}
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.4 }}>
                {p.notes}
              </p>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 14,
            padding: '12px 14px',
            border: '1px solid rgba(61,139,253,0.25)',
            borderRadius: 8,
            background: 'rgba(61,139,253,0.06)',
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, color: '#3d8bfd' }}>
            Swing trading heuristics (trader notes · not financial advice)
          </div>
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.5 }}>
            {swingHeuristics.map((h, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {h}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {openSwings.length === 0 && themeExposure.length === 0 && closedSwings.length === 0 && (
        <div className="card">
          <p className="muted">No trades found. Import trades from CSV or add manual trades to populate Research Pro.</p>
        </div>
      )}
    </div>
  );
}
