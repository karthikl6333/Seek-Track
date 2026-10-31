import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { pnlClass } from '../../lib/format';
import {
  dayChangeAmount,
  fmtMarketCap,
  fmtPrice,
  fmtSigned,
  fmtVolume,
  sortWatchlistRows,
  type WatchlistSortKey,
} from '../../lib/watchlist';
import { RangeBar } from '../../components/RangeBar';
import { mergeWatchlistRows, STALE_AFTER_MS, staleAge } from '../../lib/marks';
import { checkedAtAfter, latestIso } from '../../lib/refreshStamp';
import { TickerLink } from '../../components/TickerLink';
import { PriceFlash } from '../../components/PriceFlash';
import type { PairDef } from '../../types/index';

import { apiGet, apiSend } from '../../api/http';
const FILTER_KEY = 'watchlist-filter-open';

export interface WatchlistRef {
  /**
   * Read-only: GET /api/watchlist (for auto-cycle). Pass `checkedAt` (client time) when the caller
   * just completed a successful quote refresh that covered the watchlist symbols, so the
   * "Last refreshed" stamp moves even if no price changed (server skipped the row writes).
   */
  reload: (opts?: { checkedAt?: string | null }) => Promise<void>;
  forceRefresh: () => Promise<void>; // Manual button: POST /api/watchlist/refresh
  /** Symbols currently loaded (null until the first load), so App needn't GET /api/watchlist. */
  getSymbols: () => string[] | null;
}

interface WatchlistRow {
  symbol: string;
  name?: string | null;
  last: number | null;
  pctChange: number | null;
  valChange: number | null;
  bid: number | null;
  ask: number | null;
  marketCap: number | null;
  volume: number | null;
  week52High: number | null;
  week52Low: number | null;
  updatedAt: string | null;
}

interface WatchlistPayload {
  symbols: string[];
  rows: WatchlistRow[];
  lastRefreshAt: string | null;
}

export interface WatchlistProps {
  compact?: boolean;
  watchlistRef?: React.RefObject<WatchlistRef>;
  openSymbols?: string[];
  pairs?: PairDef[];
}

type SortKey = WatchlistSortKey;

export function Watchlist(props: WatchlistProps = {}) {
  const {
    compact = false,
    watchlistRef,
    openSymbols = [],
    pairs = [],
  } = props;

  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  /** Client time of the last successful refresh (moves even when nothing changed). */
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('symbol');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [filterOpen, setFilterOpen] = useState(() => {
    try {
      return localStorage.getItem(FILTER_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const refreshInProgressRef = useRef(false);

  const applyPayload = useCallback((data: WatchlistPayload) => {
    // Preserve last known prices when a row comes back with last=null (failed Yahoo fetch etc.).
    setRows((prev) => mergeWatchlistRows(prev, data.rows ?? []));
    setLastRefreshAt(data.lastRefreshAt ?? null);
  }, []);

  /**
   * Read-only reload: GET /api/watchlist (re-reads marks join)
   * Used by App's auto-cycle after server refresh
   */
  const reload = useCallback(async (opts?: { checkedAt?: string | null }) => {
    if (opts?.checkedAt) setCheckedAt((prev) => latestIso(prev, opts.checkedAt));
    try {
      const data = await apiGet<WatchlistPayload>('/api/watchlist');
      applyPayload(data);
    } catch (e) {
      setError(String(e));
    }
  }, [applyPayload]);

  /**
   * Force server refresh: POST /api/watchlist/refresh
   * Used by manual Refresh button
   */
  const forceRefresh = useCallback(async () => {
    if (refreshInProgressRef.current) return;
    setError(null);
    setBusy(true);
    refreshInProgressRef.current = true;
    try {
      const data = await apiSend<WatchlistPayload & { error?: string; ok?: boolean }>(
        '/api/watchlist/refresh',
        'POST',
      );
      applyPayload(data);
      // 200 with ok !== false = Yahoo was checked (even if nothing changed and no row was written).
      const at = new Date();
      setCheckedAt((prev) => checkedAtAfter(prev, data, at));
    } catch (e) {
      setError(String(e));
      try {
        await reload();
      } catch {
        // ignore
      }
    } finally {
      setBusy(false);
      refreshInProgressRef.current = false;
    }
  }, [applyPayload, reload]);

  const loadedSymbolsRef = useRef<string[] | null>(null);
  useEffect(() => {
    if (rows.length > 0 || lastRefreshAt !== null) loadedSymbolsRef.current = rows.map((r) => r.symbol);
  }, [rows, lastRefreshAt]);

  useImperativeHandle(
    watchlistRef,
    () => ({
      reload,
      forceRefresh,
      getSymbols: () => loadedSymbolsRef.current,
    }),
    [reload, forceRefresh],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await reload(); // Initial GET load only (no POST)
        if (cancelled) return;
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  const addSymbol = async () => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setError(null);
    setBusy(true);
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
    setError(null);
    setBusy(true);
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

  const toggleFilterOpen = () => {
    setFilterOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(FILTER_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const visibleRows = useMemo(() => {
    const withDayChange = rows.map((r) => ({ ...r, valChange: dayChangeAmount(r.last, r.pctChange, r.valChange) }));
    if (!filterOpen) return withDayChange;

    const allowedSet = new Set(openSymbols.map((s) => s.toUpperCase()));

    for (const sym of openSymbols) {
      const upper = sym.toUpperCase();
      const pair = pairs.find((p) => p.etf.toUpperCase() === upper);
      if (pair) {
        allowedSet.add(pair.underlying.toUpperCase());
      }
    }

    return withDayChange.filter((r) => allowedSet.has(r.symbol.toUpperCase()));
  }, [rows, filterOpen, openSymbols, pairs]);

  const sorted = useMemo(() => sortWatchlistRows(visibleRows, sortKey, sortDir), [visibleRows, sortKey, sortDir]);

  const arrow = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 1 ? ' ▲' : ' ▼';
  };

  const lastStamp = latestIso(checkedAt, lastRefreshAt);
  const lastLabel = lastStamp
    ? new Date(lastStamp).toLocaleString(undefined, { timeZone: 'Asia/Kolkata' }) + ' IST'
    : null;

  // Yahoo/Google-Finance style: Symbol (+ name), Last, Chg $, Chg %, 52w range bar, 52w High/Low, Mkt cap, Volume.
  const columns: Array<[SortKey, string, string, string?]> = [
    ['symbol', 'Symbol', 'left wl-sym'],
    ['last', 'Last', ''],
    ['valChange', 'Chg $', ''],
    ['pctChange', 'Chg %', ''],
    ['range', '52w range', 'wl-range-col', 'Position of the last price within the 52-week range'],
    ['week52High', '52w High', ''],
    ['week52Low', '52w Low', ''],
    ['marketCap', 'Mkt cap', ''],
    ['volume', 'Volume', ''],
  ];

  return (
    <div className={`card watchlist-card${compact ? ' watchlist-side' : ''}`}>
      <div className="watchlist-toolbar">
        <div style={{ flex: '0 1 auto', minWidth: 0 }}>
          <h3 style={{ margin: 0 }}>Watchlist</h3>
          {lastLabel && (
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
              Last refreshed: {lastLabel}
            </p>
          )}
        </div>
        <div className="watchlist-toolbar-controls">
          <input
            className="mono"
            placeholder="Ticker"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addSymbol();
            }}
            aria-label="Watchlist ticker"
            data-ticker-search
            style={{ maxWidth: '70px' }}
          />
          <button
            type="button"
            className={`btn small${filterOpen ? ' primary' : ''}`}
            onClick={toggleFilterOpen}
            title={filterOpen ? 'Show all watchlist symbols' : 'Filter to open positions + underlyings'}
          >
            {filterOpen ? 'Open' : 'All'}
          </button>
          <button
            type="button"
            className="btn primary small"
            disabled={busy || !symbol.trim()}
            onClick={() => void addSymbol()}
          >
            Add
          </button>
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={() => void forceRefresh()}
            title="Force refresh Yahoo quotes for watchlist now"
            style={{
              opacity: busy ? 0.6 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {busy ? '⟳' : 'Refresh'}
          </button>
        </div>
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
              {columns.map(([key, label, align, hint]) => (
                <th
                  key={key}
                  className={align}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  title={hint ?? `Sort by ${label}`}
                  aria-sort={sortKey === key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}
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
                <td className="left wl-sym">
                  <TickerLink symbol={r.symbol} />
                  {r.name && (
                    <span className="wl-name" title={r.name}>
                      {r.name}
                    </span>
                  )}
                </td>
                <td className="mono" title={r.updatedAt ? `Last price update: ${r.updatedAt}` : undefined}>
                  <PriceFlash value={r.last}>{fmtPrice(r.last)}</PriceFlash>
                  {(() => {
                    const age = r.last != null ? staleAge(r.updatedAt, Date.now(), STALE_AFTER_MS) : null;
                    return age ? (
                      <span className="muted" style={{ fontSize: 10, marginLeft: 4 }}>
                        {age}
                      </span>
                    ) : null;
                  })()}
                </td>
                <td className={pnlClass(r.valChange)}>{fmtSigned(r.valChange)}</td>
                <td className={pnlClass(r.pctChange)}>{fmtSigned(r.pctChange, 2, '%')}</td>
                <td className="wl-range-col">
                  <RangeBar last={r.last} low={r.week52Low} high={r.week52High} />
                </td>
                <td className="mono">{fmtPrice(r.week52High)}</td>
                <td className="mono">{fmtPrice(r.week52Low)}</td>
                <td className="mono">{fmtMarketCap(r.marketCap)}</td>
                <td className="mono">{fmtVolume(r.volume)}</td>
                <td>
                  <button
                    type="button"
                    className="btn small ghost"
                    style={{
                      minHeight: compact ? 24 : 32,
                      minWidth: compact ? 24 : 32,
                      fontSize: compact ? 15 : 18,
                      lineHeight: 1,
                      padding: compact ? '1px 3px' : undefined
                    }}
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
                <td className="left muted" colSpan={10}>
                  No tickers. Add a symbol above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
        Same Yahoo quote as the price marks (no extra calls). Market cap shows — when Yahoo&apos;s chart feed
        doesn&apos;t include it.
        {lastLabel ? ` · Quotes: ${lastLabel}` : ''}
      </p>
    </div>
  );
}
