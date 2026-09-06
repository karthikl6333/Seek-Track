import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { fmtMoney, fmtPct, pnlClass } from '../lib/format';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
const POLL_MS = 15 * 60 * 1000;

interface UniverseRow {
  symbol: string;
  name: string;
  sortOrder: number;
  sectorNote: string;
}

interface EtfMapRow {
  underlying: string;
  etf: string;
  direction: 'bull' | 'bear';
  factor: number;
  source: string;
  updatedAt: string;
}

interface QuoteSnap {
  symbol: string;
  price: number | null;
  dayPct: number | null;
  updatedAt: string | null;
}

interface TableRow {
  underlying: string;
  name: string;
  sectorNote: string;
  bullEtf: string | null;
  bullFactor: number | null;
  bearEtf: string | null;
  bearFactor: number | null;
  bullEtfs: EtfMapRow[];
  bearEtfs: EtfMapRow[];
  underlyingLast: number | null;
  bullLast: number | null;
  bearLast: number | null;
  underlyingDayPct: number | null;
  bullDayPct: number | null;
  bearDayPct: number | null;
  updated: string | null;
}

interface NewsItem {
  title: string;
  source: string;
  publishedAt: string | null;
  url: string;
}

interface ResearchSummary {
  universe: UniverseRow[];
  maps: EtfMapRow[];
  quotes: Record<string, QuoteSnap>;
  rows: TableRow[];
  lastRefreshAt: string | null;
}

interface ResearchDetail {
  underlying: UniverseRow;
  maps: EtfMapRow[];
  bull: EtfMapRow | null;
  bear: EtfMapRow | null;
  quotes: Record<string, QuoteSnap>;
  row: TableRow;
  chartSymbols: string[];
  chart: Array<Record<string, string | number | null>>;
  news: NewsItem[];
  newsError: string | null;
  lastRefreshAt: string | null;
}

const CHART_COLORS = ['#3d8bfd', '#3dd68c', '#f07178', '#e6b450', '#20c997'];

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
  }
  return res.json() as Promise<T>;
}

function fmtFactor(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n}x`;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function Research() {
  const [summary, setSummary] = useState<ResearchSummary | null>(null);
  const [detail, setDetail] = useState<ResearchDetail | null>(null);
  const [selected, setSelected] = useState<string>('NVDA');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    const data = await apiGet<ResearchSummary>('/api/research');
    setSummary(data);
    if (data.universe.length && !data.universe.some((u) => u.symbol === selected)) {
      setSelected(data.universe[0].symbol);
    }
  }, [selected]);

  const loadDetail = useCallback(async (symbol: string) => {
    const data = await apiGet<ResearchDetail>(`/api/research/${encodeURIComponent(symbol)}`);
    setDetail(data);
  }, []);

  const refreshAll = useCallback(async (forceServer = false) => {
    setBusy(true);
    setError(null);
    try {
      if (forceServer) {
        await fetch(`${API_BASE}/api/research/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remap: true }),
        });
      }
      await loadSummary();
      await loadDetail(selected);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [loadDetail, loadSummary, selected]);

  useEffect(() => {
    void refreshAll(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    loadDetail(selected)
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, loadDetail]);

  useEffect(() => {
    const id = setInterval(() => {
      void refreshAll(false);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refreshAll]);

  const universe = summary?.universe ?? [];
  const rows = summary?.rows ?? [];
  const selectedRow = useMemo(
    () => rows.find((r) => r.underlying === selected) ?? detail?.row ?? null,
    [rows, selected, detail],
  );

  const chartData = detail?.chart ?? [];
  const chartSymbols = detail?.chartSymbols ?? [];

  return (
    <div className="stack">
      <div className="card">
        <div className="research-toolbar">
          <div>
            <h3 style={{ marginBottom: 4 }}>Universe</h3>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Top silicon / semiconductor names · quotes refresh ~15m
            </p>
          </div>
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={() => void refreshAll(true)}
          >
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div className="ticker-row">
          {universe.map((u) => (
            <button
              key={u.symbol}
              type="button"
              className={`ticker-btn${selected === u.symbol ? ' active' : ''}`}
              onClick={() => setSelected(u.symbol)}
              title={u.name}
            >
              <span className="mono">{u.symbol}</span>
              <span className="ticker-name">{u.name}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="caveat" role="alert">
          {error}
        </div>
      )}

      <div className="grid-2 research-split">
        <div className="card">
          <h3>{selected} · linked ETFs</h3>
          {selectedRow ? (
            <div className="stack" style={{ gap: 10 }}>
              <div className="etf-pill-row">
                <div className="etf-pill bull">
                  <span className="stat-label">Bull ETF(s)</span>
                  {selectedRow.bullEtfs?.length ? (
                    selectedRow.bullEtfs.map((m) => (
                      <div key={m.etf} className="mono">
                        {m.etf}{' '}
                        <span className="muted">{fmtFactor(m.factor)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="muted">None found</div>
                  )}
                </div>
                <div className="etf-pill bear">
                  <span className="stat-label">Bear / inverse ETF(s)</span>
                  {selectedRow.bearEtfs?.length ? (
                    selectedRow.bearEtfs.map((m) => (
                      <div key={m.etf} className="mono">
                        {m.etf}{' '}
                        <span className="muted">{fmtFactor(m.factor)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="muted">None found</div>
                  )}
                </div>
              </div>
              <div className="grid-3">
                <div>
                  <div className="stat-label">Underlying last</div>
                  <div className="stat-value" style={{ fontSize: 18 }}>
                    {fmtMoney(selectedRow.underlyingLast)}
                  </div>
                  <div className={pnlClass(selectedRow.underlyingDayPct)}>
                    {fmtPct(selectedRow.underlyingDayPct)}
                  </div>
                </div>
                <div>
                  <div className="stat-label">Bull last</div>
                  <div className="stat-value" style={{ fontSize: 18 }}>
                    {fmtMoney(selectedRow.bullLast)}
                  </div>
                  <div className={pnlClass(selectedRow.bullDayPct)}>
                    {fmtPct(selectedRow.bullDayPct)}
                  </div>
                </div>
                <div>
                  <div className="stat-label">Bear last</div>
                  <div className="stat-value" style={{ fontSize: 18 }}>
                    {fmtMoney(selectedRow.bearLast)}
                  </div>
                  <div className={pnlClass(selectedRow.bearDayPct)}>
                    {fmtPct(selectedRow.bearDayPct)}
                  </div>
                </div>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Updated {fmtTime(selectedRow.updated)}
                {selectedRow.sectorNote ? ` · ${selectedRow.sectorNote}` : ''}
              </p>
            </div>
          ) : (
            <p className="muted">Select a ticker.</p>
          )}
        </div>

        <div className="card" style={{ height: 320 }}>
          <h3>Recent closes (~3mo)</h3>
          {chartData.length === 0 || chartSymbols.length === 0 ? (
            <p className="muted">No chart data.</p>
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
      </div>

      <div className="card">
        <h3>ETF map · quotes</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="left">Underlying</th>
                <th className="left">Bull ETF</th>
                <th>Bull factor</th>
                <th className="left">Bear ETF</th>
                <th>Bear factor</th>
                <th>Underlying last</th>
                <th>Bull last</th>
                <th>Bear last</th>
                <th>Underlying day %</th>
                <th>Bull day %</th>
                <th>Bear day %</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.underlying}
                  className={r.underlying === selected ? 'row-selected' : undefined}
                  onClick={() => setSelected(r.underlying)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="left mono">{r.underlying}</td>
                  <td className="left mono">{r.bullEtf ?? '—'}</td>
                  <td className="mono">{fmtFactor(r.bullFactor)}</td>
                  <td className="left mono">{r.bearEtf ?? '—'}</td>
                  <td className="mono">{fmtFactor(r.bearFactor)}</td>
                  <td className="mono">{fmtMoney(r.underlyingLast)}</td>
                  <td className="mono">{fmtMoney(r.bullLast)}</td>
                  <td className="mono">{fmtMoney(r.bearLast)}</td>
                  <td className={pnlClass(r.underlyingDayPct)}>{fmtPct(r.underlyingDayPct)}</td>
                  <td className={pnlClass(r.bullDayPct)}>{fmtPct(r.bullDayPct)}</td>
                  <td className={pnlClass(r.bearDayPct)}>{fmtPct(r.bearDayPct)}</td>
                  <td className="muted">{fmtTime(r.updated)}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={12} className="left muted">
                    No research data yet. Click Refresh.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>News · {selected}</h3>
        {detail?.newsError && !detail.news.length ? (
          <p className="muted">No headlines available ({detail.newsError}).</p>
        ) : !detail?.news?.length ? (
          <p className="muted">No headlines found for {selected}.</p>
        ) : (
          <ul className="news-list">
            {detail.news.map((n) => (
              <li key={n.url + n.title}>
                <a href={n.url} target="_blank" rel="noopener noreferrer">
                  {n.title}
                </a>
                <div className="muted" style={{ fontSize: 12 }}>
                  {n.source}
                  {n.publishedAt ? ` · ${fmtTime(n.publishedAt)}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
