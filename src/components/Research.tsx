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
import { fmtMoney, fmtPct, moneyTone, pnlClass } from '../lib/format';
import { TickerLink, yahooQuoteUrl } from '../lib/yahoo';
import { CrossCheck } from './CrossCheck';
import type { AppSettings } from '../types';

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
  source?: string;
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

async function apiSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j?.error) msg = j.error;
      else if (text) msg += `: ${text}`;
    } catch {
      if (text) msg += `: ${text}`;
    }
    throw new Error(msg);
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

/** Educational, generic characteristics — not personalized advice. */
function generalCharacteristics(
  kind: 'underlying' | 'bull' | 'bear',
  factor: number | null,
): { pros: string[]; cons: string[] } {
  if (kind === 'underlying') {
    return {
      pros: ['Direct ownership exposure to the stock', 'No daily reset or leverage decay'],
      cons: ['No leverage amplification', 'Company-specific risk'],
    };
  }
  if (kind === 'bear') {
    return {
      pros: [
        'Can profit from daily declines in the underlying',
        'Hedge-style short exposure without shorting the stock',
      ],
      cons: [
        'Daily reset / compounding / volatility decay',
        'Loses when the underlying rises',
        'Path dependence; not for buy-and-hold',
        'High expense / complexity',
      ],
    };
  }
  const lev =
    factor != null && Number.isFinite(factor) ? `${Math.abs(factor)}x` : 'leveraged';
  return {
    pros: [
      `Amplified daily upside vs underlying (${lev})`,
      'Tactical short-term tool',
    ],
    cons: [
      'Daily reset / compounding / volatility decay',
      'Not for buy-and-hold',
      'Can lose even if underlying rises over multi-day periods',
      'High expense / complexity',
    ],
  };
}

interface ResearchProps {
  settings: AppSettings | null;
}

export function Research({ settings }: ResearchProps) {
  const [summary, setSummary] = useState<ResearchSummary | null>(null);
  const [detail, setDetail] = useState<ResearchDetail | null>(null);
  const [selected, setSelected] = useState<string>('NVDA');
  const [focusSymbol, setFocusSymbol] = useState<string>('NVDA');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addSymbol, setAddSymbol] = useState('');
  const [addName, setAddName] = useState('');
  const [universeBusy, setUniverseBusy] = useState(false);

  const selectUnderlying = useCallback((symbol: string) => {
    setSelected(symbol);
    setFocusSymbol(symbol);
  }, []);

  const loadSummary = useCallback(async () => {
    const data = await apiGet<ResearchSummary>('/api/research');
    setSummary(data);
    if (!data.universe.some((u) => u.symbol === selected)) {
      const next = data.universe[0]?.symbol ?? '';
      setSelected(next);
      if (next) setFocusSymbol(next);
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
      if (selected) await loadDetail(selected);
      else setDetail(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [loadDetail, loadSummary, selected]);

  const handleAddUniverse = useCallback(async () => {
    const sym = addSymbol.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(sym)) {
      setError('Ticker: letters/digits only, 1–10 chars');
      return;
    }
    setUniverseBusy(true);
    setError(null);
    try {
      const body: { symbol: string; name?: string } = { symbol: sym };
      const name = addName.trim();
      if (name) body.name = name;
      await apiSend<{ universe: UniverseRow[] }>('/api/research/universe', 'POST', body);
      setAddSymbol('');
      setAddName('');
      setSelected(sym);
      setFocusSymbol(sym);
      await loadSummary();
      await loadDetail(sym);
    } catch (e) {
      setError(String(e));
    } finally {
      setUniverseBusy(false);
    }
  }, [addSymbol, addName, loadSummary, loadDetail]);

  const handleRemoveUniverse = useCallback(
    async (symbol: string) => {
      if (!window.confirm(`Remove ${symbol} from research universe?`)) return;
      setUniverseBusy(true);
      setError(null);
      try {
        const result = await apiSend<{ universe: UniverseRow[] }>(
          `/api/research/universe/${encodeURIComponent(symbol)}`,
          'DELETE',
        );
        const next =
          selected === symbol
            ? result.universe[0]?.symbol ?? ''
            : selected;
        setSummary((prev) =>
          prev
            ? {
                ...prev,
                universe: result.universe,
                rows: (prev.rows ?? []).filter((r) => r.underlying !== symbol),
                maps: (prev.maps ?? []).filter((m) => m.underlying !== symbol),
              }
            : prev,
        );
        if (next !== selected) {
          setSelected(next);
          setFocusSymbol(next || focusSymbol);
        }
        await loadSummary();
        if (next) await loadDetail(next);
        else setDetail(null);
      } catch (e) {
        setError(String(e));
      } finally {
        setUniverseBusy(false);
      }
    },
    [selected, focusSymbol, loadSummary, loadDetail],
  );

  useEffect(() => {
    void refreshAll(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
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

  const allMaps = useMemo(() => {
    const fromDetail = detail?.maps ?? [];
    const fromSummary = summary?.maps ?? [];
    const byKey = new Map<string, EtfMapRow>();
    for (const m of [...fromSummary, ...fromDetail]) {
      byKey.set(`${m.underlying}|${m.etf}|${m.direction}`, m);
    }
    return [...byKey.values()];
  }, [detail, summary]);

  /** One row per bull/bear ETF for the currently selected underlying only. */
  const selectedEtfTableRows = useMemo(() => {
    const maps =
      detail?.maps?.filter((m) => m.underlying === selected) ??
      summary?.maps?.filter((m) => m.underlying === selected) ??
      [
        ...(selectedRow?.bullEtfs ?? []),
        ...(selectedRow?.bearEtfs ?? []),
      ];
    const quotes = detail?.quotes ?? summary?.quotes ?? {};
    const underQ = quotes[selected];
    const sorted = [...maps].sort((a, b) => {
      if (a.direction !== b.direction) return a.direction === 'bull' ? -1 : 1;
      return Math.abs(b.factor) - Math.abs(a.factor) || a.etf.localeCompare(b.etf);
    });
    return sorted.map((m) => {
      const etfQ = quotes[m.etf];
      return {
        ...m,
        underlyingLast: underQ?.price ?? selectedRow?.underlyingLast ?? null,
        underlyingDayPct: underQ?.dayPct ?? selectedRow?.underlyingDayPct ?? null,
        etfLast: etfQ?.price ?? null,
        etfDayPct: etfQ?.dayPct ?? null,
        quoteUpdated: etfQ?.updatedAt ?? underQ?.updatedAt ?? m.updatedAt ?? null,
      };
    });
  }, [detail, summary, selected, selectedRow]);

  const focusInfo = useMemo(() => {
    const sym = (focusSymbol || selected || '').toUpperCase();
    if (!sym) return null;
    const quotes = { ...(summary?.quotes ?? {}), ...(detail?.quotes ?? {}) };
    const q = quotes[sym];
    const mapHit =
      allMaps.find((m) => m.etf === sym) ??
      selectedRow?.bullEtfs?.find((m) => m.etf === sym) ??
      selectedRow?.bearEtfs?.find((m) => m.etf === sym) ??
      null;
    const uni = universe.find((u) => u.symbol === sym);
    const isUnderlying = Boolean(uni) || sym === selected;
    const kind: 'underlying' | 'bull' | 'bear' = mapHit
      ? mapHit.direction
      : isUnderlying
        ? 'underlying'
        : 'bull';
    const factor = mapHit?.factor ?? null;
    const underSym = mapHit?.underlying ?? (isUnderlying ? sym : selected);
    const underUni = universe.find((u) => u.symbol === underSym);
    const name = uni?.name
      ?? (mapHit
        ? `${mapHit.direction === 'bull' ? 'Bull' : 'Bear'} ${fmtFactor(mapHit.factor)} · ${mapHit.underlying}`
        : underUni?.name ?? sym);
    const chars = generalCharacteristics(kind, factor);
    return {
      symbol: sym,
      name,
      kind,
      direction: mapHit?.direction ?? null,
      factor,
      underlying: mapHit ? mapHit.underlying : isUnderlying ? null : underSym,
      price: q?.price ?? (sym === selected ? selectedRow?.underlyingLast ?? null : null),
      dayPct: q?.dayPct ?? (sym === selected ? selectedRow?.underlyingDayPct ?? null : null),
      source: q?.source ?? mapHit?.source ?? null,
      updated: q?.updatedAt ?? mapHit?.updatedAt ?? (sym === selected ? selectedRow?.updated ?? null : null),
      sectorNote: uni?.sectorNote ?? null,
      chars,
    };
  }, [focusSymbol, selected, summary, detail, allMaps, universe, selectedRow]);

  const chartData = detail?.chart ?? [];
  const chartSymbols = detail?.chartSymbols ?? [];

  return (
    <div className="stack">
      <div className="card">
        <div className="research-toolbar">
          <div>
            <h3 style={{ marginBottom: 4 }}>Universe</h3>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Add/remove tickers · quotes refresh ~15m
            </p>
          </div>
          <button
            type="button"
            className="btn small"
            disabled={busy || universeBusy}
            onClick={() => void refreshAll(true)}
          >
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div className="universe-controls">
          <input
            className="universe-input mono"
            type="text"
            placeholder="Ticker"
            maxLength={10}
            value={addSymbol}
            disabled={universeBusy}
            onChange={(e) => setAddSymbol(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAddUniverse();
            }}
            aria-label="Add ticker"
          />
          <input
            className="universe-input"
            type="text"
            placeholder="Name (optional)"
            value={addName}
            disabled={universeBusy}
            onChange={(e) => setAddName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAddUniverse();
            }}
            aria-label="Optional name"
          />
          <button
            type="button"
            className="btn small"
            disabled={universeBusy || !addSymbol.trim()}
            onClick={() => void handleAddUniverse()}
          >
            {universeBusy ? '…' : 'Add'}
          </button>
        </div>
        <div className="ticker-row">
          {universe.map((u) => (
            <div
              key={u.symbol}
              className={`ticker-chip${selected === u.symbol ? ' active' : ''}`}
            >
              <div className="ticker-main">
                <span className="mono ticker-chip-symbol">{u.symbol}</span>
                <button
                  type="button"
                  className="ticker-select"
                  onClick={() => selectUnderlying(u.symbol)}
                  title={u.name}
                >
                  <span className="ticker-name">{u.name}</span>
                </button>
              </div>
              <button
                type="button"
                className="ticker-remove"
                title={`Remove ${u.symbol}`}
                disabled={universeBusy}
                aria-label={`Remove ${u.symbol}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleRemoveUniverse(u.symbol);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {settings && <CrossCheck pairs={settings.pairs} />}

      {error && (
        <div className="caveat" role="alert">
          {error}
        </div>
      )}

      <div className="research-layout">
        <div className="research-main">
          <div className="card">
            <h3><span className="mono">{selected}</span> · linked ETFs</h3>
            {selectedRow ? (
              <div className="stack" style={{ gap: 10 }}>
                <div className="etf-pill-row">
                  <div className="etf-pill bull">
                    <span className="stat-label">Bull ETF(s)</span>
                    {selectedRow.bullEtfs?.length ? (
                      selectedRow.bullEtfs.map((m) => (
                        <div
                          key={m.etf}
                          role="button"
                          tabIndex={0}
                          className={`etf-focus-item${focusSymbol === m.etf ? ' focused' : ''}`}
                          onClick={() => setFocusSymbol(m.etf)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setFocusSymbol(m.etf);
                            }
                          }}
                        >
                          <span className="mono etf-focus-link">{m.etf}</span>{' '}
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
                        <div
                          key={m.etf}
                          role="button"
                          tabIndex={0}
                          className={`etf-focus-item${focusSymbol === m.etf ? ' focused' : ''}`}
                          onClick={() => setFocusSymbol(m.etf)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setFocusSymbol(m.etf);
                            }
                          }}
                        >
                          <span className="mono etf-focus-link">{m.etf}</span>{' '}
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

          <div className="card">
            <h3>
              ETF map · quotes · <span className="mono">{selected}</span>
            </h3>
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
              All known bull and bear single-stock ETFs for the selected underlying (not the full
              universe). Click a row to focus the info panel.
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="left">Direction</th>
                    <th className="left">ETF</th>
                    <th>Factor</th>
                    <th>ETF last</th>
                    <th>ETF day %</th>
                    <th>Underlying last</th>
                    <th>Underlying day %</th>
                    <th className="left">Source</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedEtfTableRows.map((r) => (
                    <tr
                      key={`${r.direction}-${r.etf}`}
                      className={`etf-map-row${focusSymbol === r.etf ? ' row-selected' : ''}`}
                      onClick={() => setFocusSymbol(r.etf)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="left">
                        <span className={r.direction === 'bull' ? 'badge bull-badge' : 'badge bear-badge'}>
                          {r.direction === 'bull' ? 'Bull' : 'Bear'}
                        </span>
                      </td>
                      <td className="left">
                        <span className="mono">{r.etf}</span>
                      </td>
                      <td className="mono">{fmtFactor(r.factor)}</td>
                      <td className="mono">{fmtMoney(r.etfLast)}</td>
                      <td className={pnlClass(r.etfDayPct)}>{fmtPct(r.etfDayPct)}</td>
                      <td className="mono">{fmtMoney(r.underlyingLast)}</td>
                      <td className={pnlClass(r.underlyingDayPct)}>{fmtPct(r.underlyingDayPct)}</td>
                      <td className="left muted">{r.source || '—'}</td>
                      <td className="muted">{fmtTime(r.quoteUpdated)}</td>
                    </tr>
                  ))}
                  {!selectedEtfTableRows.length && (
                    <tr>
                      <td colSpan={9} className="left muted">
                        No bull/bear ETFs mapped for <span className="mono">{selected}</span> yet. Click Refresh.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
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

        <div className="research-side">
          <div className="card etf-info-card">
            <h3>ETF / ticker info</h3>
            {focusInfo ? (
              <div className="stack" style={{ gap: 10 }}>
                <div className="etf-info-basics">
                  <div className="etf-info-symbol">
                    <TickerLink symbol={focusInfo.symbol} />
                    {focusInfo.direction && (
                      <span
                        className={
                          focusInfo.direction === 'bull' ? 'badge bull-badge' : 'badge bear-badge'
                        }
                        style={{ marginLeft: 8 }}
                      >
                        {focusInfo.direction === 'bull' ? 'Bull' : 'Bear'}{' '}
                        {fmtFactor(focusInfo.factor)}
                      </span>
                    )}
                    {focusInfo.kind === 'underlying' && (
                      <span className="badge" style={{ marginLeft: 8, background: 'rgba(61,139,253,0.15)', color: '#3d8bfd' }}>
                        Underlying
                      </span>
                    )}
                  </div>
                  <div className="etf-info-name">{focusInfo.name}</div>
                  {focusInfo.underlying && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      Underlying{' '}
                      <button
                        type="button"
                        className="linkish mono"
                        onClick={() => selectUnderlying(focusInfo.underlying!)}
                      >
                        {focusInfo.underlying}
                      </button>
                      {' · '}
                      <TickerLink symbol={focusInfo.underlying} />
                    </div>
                  )}
                  {focusInfo.sectorNote && (
                    <div className="muted" style={{ fontSize: 12 }}>{focusInfo.sectorNote}</div>
                  )}
                  <div className="grid-2" style={{ gap: 8, marginTop: 4 }}>
                    <div>
                      <div className="stat-label">Last</div>
                      <div className="stat-value" style={{ fontSize: 18 }}>
                        {fmtMoney(focusInfo.price)}
                      </div>
                    </div>
                    <div>
                      <div className="stat-label">Day %</div>
                      <div className={`stat-value ${pnlClass(focusInfo.dayPct)} ${moneyTone("stat")}`} style={{ fontSize: 18 }}>
                        {fmtPct(focusInfo.dayPct)}
                      </div>
                    </div>
                  </div>
                  <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                    {focusInfo.source ? `Source ${focusInfo.source}` : 'Source —'}
                    {' · '}
                    Updated {fmtTime(focusInfo.updated)}
                  </p>
                </div>

                <div>
                  <div className="stat-label" style={{ marginBottom: 4 }}>
                    General characteristics (not advice)
                  </div>
                  <div className="etf-info-pc">
                    <div>
                      <div className="etf-info-pc-label pros">Pros</div>
                      <ul className="etf-info-pros">
                        {focusInfo.chars.pros.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="etf-info-pc-label cons">Cons</div>
                      <ul className="etf-info-cons">
                        {focusInfo.chars.cons.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                <a
                  className="btn etf-yahoo-btn"
                  href={yahooQuoteUrl(focusInfo.symbol)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open on Yahoo Finance
                </a>
              </div>
            ) : (
              <p className="muted">Select a ticker.</p>
            )}
          </div>

          <div className="card">
            <h3>News · <span className="mono">{selected}</span></h3>
            {detail?.newsError && !detail.news.length ? (
              <p className="muted">No headlines available ({detail.newsError}).</p>
            ) : !detail?.news?.length ? (
              <p className="muted">No headlines found for <span className="mono">{selected}</span>.</p>
            ) : (
              <ul className="news-list news-list-side">
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
      </div>
    </div>
  );
}
