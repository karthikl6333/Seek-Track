import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ResearchDetail } from './types';

const CHART_COLORS = ['#3d8bfd', '#3dd68c', '#f07178', '#e6b450', '#20c997'];

export function PriceChartCard({
  chartData,
  chartSymbols,
  selected,
}: {
  chartData: ResearchDetail['chart'];
  chartSymbols: string[];
  selected: string;
}) {
  return (
    <div className="card" style={{ height: 320 }}>
      <h3>Recent closes (~3mo)</h3>
      {chartData.length === 0 || chartSymbols.length === 0 ? (
        <p className="muted empty-state">No chart data.</p>
      ) : (
        <ResponsiveContainer width="100%" height="88%">
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#243044" />
            <XAxis
              dataKey="date"
              stroke="#8b9bb4"
              tick={{ fontSize: 10 }}
              minTickGap={32}
            />
            <YAxis
              stroke="#8b9bb4"
              tick={{ fontSize: 10 }}
              domain={['auto', 'auto']}
              width={56}
            />
            <Tooltip
              contentStyle={{ background: '#121821', border: '1px solid #243044' }}
              labelStyle={{ color: '#8b9bb4' }}
            />
            <Legend />
            {chartSymbols.map((sym, i) => (
              <Line
                key={sym}
                type="monotone"
                dataKey={sym}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                dot={false}
                strokeWidth={sym === selected ? 2.2 : 1.5}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
