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
  const bySymbol =
    store.analysis?.positions.map((p) => ({
      symbol: p.symbol,
      realized: Number(p.realizedPnl.toFixed(2)),
      unrealized: Number((p.unrealizedPnl ?? 0).toFixed(2)),
    })) ?? [];

  const byTheme =
    store.analysis?.themes.map((t) => ({
      theme: t.theme.replace(' family', ''),
      realized: Number(t.realizedPnl.toFixed(2)),
      unrealized: Number((t.unrealizedPnl ?? 0).toFixed(2)),
    })) ?? [];

  return (
    <div className="stack">
      <div className="card" style={{ height: 360 }}>
        <h3>P&amp;L by Symbol</h3>
        {bySymbol.length === 0 ? (
          <p className="muted">Import trades to chart P&amp;L.</p>
        ) : (
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={bySymbol} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#243044" />
              <XAxis dataKey="symbol" stroke="#8b9bb4" />
              <YAxis stroke="#8b9bb4" tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ background: '#121821', border: '1px solid #243044' }}
                formatter={(v: number) => fmtMoney(v)}
              />
              <Legend />
              <Bar dataKey="realized" name="Realized" fill="#3d8bfd">
                {bySymbol.map((e) => (
                  <Cell key={e.symbol} fill={e.realized >= 0 ? '#3dd68c' : '#f07178'} />
                ))}
              </Bar>
              <Bar dataKey="unrealized" name="Unrealized" fill="#20c997" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card" style={{ height: 360 }}>
        <h3>P&amp;L by Theme</h3>
        {byTheme.length === 0 ? (
          <p className="muted">Theme rollups appear after import.</p>
        ) : (
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={byTheme} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#243044" />
              <XAxis dataKey="theme" stroke="#8b9bb4" />
              <YAxis stroke="#8b9bb4" tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ background: '#121821', border: '1px solid #243044' }}
                formatter={(v: number) => fmtMoney(v)}
              />
              <Legend />
              <Bar dataKey="realized" name="Realized" fill="#3d8bfd" />
              <Bar dataKey="unrealized" name="Unrealized" fill="#e6b450" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
