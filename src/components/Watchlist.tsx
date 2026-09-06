import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtMoney, fmtPct, pnlClass } from '../lib/format';
import { TickerLink } from '../lib/yahoo';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
const POLL_MS = 5 * 60 * 1000;

interface WatchlistRow {
  symbol: string;
  last: number | null;
  pctChange: number | null;
  valChange: number | null;
  bid: number | null;
  ask: number | null;
  marketCap: number | null;
  volume: number | null;
  updatedAt: string | null;
}

interface WatchlistPayload {
  symbols: string[];
  rows: WatchlistRow[];
  lastRefreshAt: string | null;
}

type SortKey =
  | 'symbol'
  | 'last'
  | 'pctChange'
  | 'valChange'
  | 'bid'
  | 'ask'
  | 'marketCap'
  | 'volume';

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

function fmtVolume(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtCap(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return fmtMoney(n, 0);
}

function compareNullable(
  a: number | string | null | undefined,
  b: number | string | null | undefined,
  dir: 1 | -1,
): number {
  const aNull = a === null || a === undefined || a === '';
  const bNull = b === null || b === undefined || b === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b) * dir;
  }
  return (Number(a) - Number(b)) * dir;
}

export function Watchlist({ compact = false }: { compact?: boolean } = {}) {
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('symbol');
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const applyPayload = useCallback((data: WatchlistPayload) => {
    setRows(data.rows ?? []);
    setLastRefreshAt(data.lastRefreshAt ?? null);
  }, []);

  const load = useCallback(async () => {
    const data = await apiGet<WatchlistPayload>('/api/watchlist');
    applyPayload(data);
  }, [applyPayload]);

  const refreshQuotes = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await apiSend<WatchlistPayload & { error?: string }>(
        '/api/watchlist/refresh',
        'POST',
      );
      applyPayload(data);
    } catch (e) {
      setError(String(e));
      try {
        await load();
      } catch {
        // ignore
      }
    } finally {
      setBusy(false);
    }
  }, [applyPayload, load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await load();
        if (!cancelled) {
          // Refresh quotes on mount (non-blocking after initial rows)
          void refreshQuotes();
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      void refreshQuotes();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refreshQuotes]);

  const addSymbol = async () => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiSend<WatchlistPayload>('/api/watchlist', 'POST', { symbol: sym });
      applyPayload(data);
      setSymbol('');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeSymbol = async (sym: string) => {
    setBusy(true);
    setError(null);
    try {
      const data = await apiSend<WatchlistPayload>(
        `/api/watchlist/${encodeURIComponent(sym)}`,
        'DELETE',
      );
      applyPayload(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(key === 'symbol' ? 1 : -1);
    }
  };

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      return compareNullable(av, bv, sortDir);
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const arrow = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 1 ? ' ▲' : ' ▼';
  };

  const lastLabel = lastRefreshAt
    ? new Date(lastRefreshAt).toLocaleString(undefined, { timeZone: 'Asia/Kolkata' }) + ' IST'
    : null;

  return (
    <div className={`card${compact ? " watchlist-side" : ""}`}>
      <div className="row-actions" style={{ justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 style={{ margin: 0 }}>Watchlist</h3>
          {lastLabel && (
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
              Last refreshed: {lastLabel}
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn small"
          disabled={busy}
          onClick={() => void refreshQuotes()}
          title="Refresh Yahoo quotes for watchlist now"
        >
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div
        className="row-actions"
        style={{
          gap: 8,
          marginBottom: 10,
          flexWrap: 'wrap',
          flexDirection: compact ? 'column' : 'row',
          alignItems: compact ? 'stretch' : undefined,
        }}
      >
        <input
          className="mono"
          style={{ minWidth: 120, flex: compact ? '1 1 auto' : '1 1 140px', width: compact ? '100%' : undefined }}
          placeholder="Ticker"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addSymbol();
          }}
          aria-label="Watchlist ticker"
        />
        <button
          type="button"
          className="btn primary small"
          disabled={busy || !symbol.trim()}
          onClick={() => void addSymbol()}
          style={{ minHeight: 44, minWidth: 44, width: compact ? '100%' : undefined }}
        >
          Add
        </button>
      </div>

      {error && (
        <p className="muted" style={{ fontSize: 12 }}>
          {error}
        </p>
      )}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {(
                [
                  ['symbol', 'Symbol', 'left'],
                  ['last', 'Last', ''],
                  ['pctChange', '% change', ''],
                  ['valChange', 'Val change ($)', ''],
                  ['bid', 'Bid', ''],
                  ['ask', 'Ask', ''],
                  ['marketCap', 'Market cap', ''],
                  ['volume', 'Volume', ''],
                ] as Array<[SortKey, string, string]>
              ).map(([key, label, align]) => (
                <th
                  key={key}
                  className={align}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort(key)}
                >
                  {label}
                  {arrow(key)}
                </th>
              ))}
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.symbol}>
                <td className="left">
                  <TickerLink symbol={r.symbol} />
                </td>
                <td className="mono">{fmtMoney(r.last, 2)}</td>
                <td className={pnlClass(r.pctChange)}>{fmtPct(r.pctChange)}</td>
                <td className={pnlClass(r.valChange)}>{fmtMoney(r.valChange)}</td>
                <td className="mono">{fmtMoney(r.bid, 2)}</td>
                <td className="mono">{fmtMoney(r.ask, 2)}</td>
                <td className="mono">{fmtCap(r.marketCap)}</td>
                <td className="mono">{fmtVolume(r.volume)}</td>
                <td>
                  <button
                    type="button"
                    className="btn small ghost"
                    style={{ minHeight: 44, minWidth: 44, fontSize: 18, lineHeight: 1 }}
                    title={`Remove ${r.symbol}`}
                    aria-label={`Remove ${r.symbol}`}
                    disabled={busy}
                    onClick={() => void removeSymbol(r.symbol)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td className="left muted" colSpan={9}>
                  No tickers. Add a symbol above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        {compact
          ? 'Bid/ask/cap often — from Yahoo.'
          : 'Bid, ask, and market cap are often unavailable from Yahoo chart v8 (auth-free) — shown as —.'}
        {lastLabel ? ` · Quotes: ${lastLabel}` : ''} · Auto-refresh ~5 min
      </p>
    </div>
  );
}
