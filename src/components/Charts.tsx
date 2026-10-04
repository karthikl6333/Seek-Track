import { useState, useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Store } from '../hooks/useStore';
import { fmtMoney } from '../lib/format';

export function Charts({ store }: { store: Store }) {
  const [symbolFilter, setSymbolFilter] = useState<'open' | 'top10' | 'all'>('open');
  const [stackMode, setStackMode] = useState<'stacked' | 'separate'>('separate');

  const allSymbols =
    store.analysis?.positions.map((p) => ({
      symbol: p.symbol,
      realized: Number(p.realizedPnl.toFixed(2)),
      unrealized: Number((p.unrealizedPnl ?? 0).toFixed(2)),
      totalAbsPnl: Math.abs(p.realizedPnl) + Math.abs(p.unrealizedPnl ?? 0),
      isOpen: p.quantity !== 0,
    })) ?? [];

  const bySymbol = useMemo(() => {
    let filtered = allSymbols;
    
    if (symbolFilter === 'open') {
      filtered = filtered.filter((s) => s.isOpen);
    } else if (symbolFilter === 'top10') {
      filtered = [...filtered]
        .sort((a, b) => b.totalAbsPnl - a.totalAbsPnl)
        .slice(0, 10);
    }

    return filtered.map((s) => ({
      symbol: s.symbol,
      realized: s.realized,
      unrealized: s.unrealized,
    }));
  }, [allSymbols, symbolFilter]);

  const byTheme =
    store.analysis?.themes.map((t) => ({
      theme: t.theme.replace(' family', ''),
      realized: Number(t.realizedPnl.toFixed(2)),
      unrealized: Number((t.unrealizedPnl ?? 0).toFixed(2)),
    })) ?? [];

  const handleBarClick = (data: { symbol?: string; theme?: string }) => {
    if (data.symbol) {
      store.setView('positions');
    } else if (data.theme) {
      store.setView('positions');
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>P&amp;L by Symbol</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value as 'open' | 'top10' | 'all')}
              style={{ padding: '6px 10px', fontSize: 13 }}
            >
              <option value="open">Open positions only</option>
              <option value="top10">Top 10 by P&L</option>
              <option value="all">All symbols</option>
            </select>
            <select
              value={stackMode}
              onChange={(e) => setStackMode(e.target.value as 'stacked' | 'separate')}
              style={{ padding: '6px 10px', fontSize: 13 }}
            >
              <option value="separate">Separate bars</option>
              <option value="stacked">Stacked</option>
            </select>
          </div>
        </div>
        {bySymbol.length === 0 ? (
          <p className="muted">Import trades to chart P&amp;L.</p>
        ) : (
          <div style={{ height: 360 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySymbol} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#243044" />
                <XAxis dataKey="symbol" stroke="#8b9bb4" />
                <YAxis stroke="#8b9bb4" tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: '#121821', border: '1px solid #243044' }}
                  formatter={(v: number) => fmtMoney(v)}
                />
                <Legend />
                <Bar
                  dataKey="realized"
                  name="Realized"
                  fill="#3d8bfd"
                  stackId={stackMode === 'stacked' ? 'stack' : undefined}
                  onClick={handleBarClick}
                  cursor="pointer"
                >
                  {bySymbol.map((e) => (
                    <Cell key={e.symbol} fill={e.realized >= 0 ? '#3dd68c' : '#f07178'} />
                  ))}
                </Bar>
                <Bar
                  dataKey="unrealized"
                  name="Unrealized"
                  stackId={stackMode === 'stacked' ? 'stack' : undefined}
                  onClick={handleBarClick}
                  cursor="pointer"
                >
                  {bySymbol.map((e) => (
                    <Cell key={e.symbol} fill={e.unrealized >= 0 ? '#20c997' : '#e6b450'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
          Click a bar to view details on the Positions tab
        </p>
      </div>

      <div className="card">
        <h3>P&amp;L by Theme</h3>
        {byTheme.length === 0 ? (
          <p className="muted">Theme rollups appear after import.</p>
        ) : (
          <div style={{ height: 360 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byTheme} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#243044" />
                <XAxis dataKey="theme" stroke="#8b9bb4" />
                <YAxis stroke="#8b9bb4" tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: '#121821', border: '1px solid #243044' }}
                  formatter={(v: number) => fmtMoney(v)}
                />
                <Legend />
                <Bar
                  dataKey="realized"
                  name="Realized"
                  stackId={stackMode === 'stacked' ? 'stack' : undefined}
                  onClick={handleBarClick}
                  cursor="pointer"
                >
                  {byTheme.map((t) => (
                    <Cell key={t.theme} fill={t.realized >= 0 ? '#3dd68c' : '#f07178'} />
                  ))}
                </Bar>
                <Bar
                  dataKey="unrealized"
                  name="Unrealized"
                  stackId={stackMode === 'stacked' ? 'stack' : undefined}
                  onClick={handleBarClick}
                  cursor="pointer"
                >
                  {byTheme.map((t) => (
                    <Cell key={t.theme} fill={t.unrealized >= 0 ? '#20c997' : '#e6b450'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
          Click a bar to view details on the Positions tab
        </p>
      </div>
    </div>
  );
}
