import { useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { fmtMoney, fmtPct, pnlClass } from '../../lib/format';
import { TickerLink, yahooQuoteUrl } from '../../components/TickerLink';
import { API_BASE, apiGet, apiSend } from '../../api/http';
import { SECTOR_THEMES } from './sectorThemes';
import { fmtFactor, fmtTime, generalCharacteristics } from './format';
import { PriceChartCard } from './PriceChartCard';
import { NewsCard } from './NewsCard';
import type { EtfMapRow, ResearchDetail, ResearchSummary, UniverseRow } from './types';

export interface ResearchRef {
  reload: () => Promise<void>; // Re-read research data from server (GET only)
}

export function Research({ researchRef }: { researchRef?: React.RefObject<ResearchRef> } = {}) {
  const [summary, setSummary] = useState<ResearchSummary | null>(null);
  const [detail, setDetail] = useState<ResearchDetail | null>(null);
  const [selected, setSelected] = useState<string>('NVDA');
  const [focusSymbol, setFocusSymbol] = useState<string>('NVDA');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addSymbol, setAddSymbol] = useState('');
  const [addName, setAddName] = useState('');
  const [universeBusy, setUniverseBusy] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);

  const selectUnderlying = useCallback((symbol: string) => {
    setSelected(symbol);
    setFocusSymbol(symbol);
    setSelectedTheme(null); // Clear theme when selecting an underlying
  }, []);

  const selectTheme = useCallback((theme: string) => {
    setSelectedTheme(theme);
    setSelected(''); // Clear underlying selection
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
    setError(null);
    setBusy(true);
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

  /**
   * Read-only reload: re-read research data (GET only)
   * Used by App's auto-cycle after marks are updated
   */
  const reload = useCallback(async () => {
    try {
      await loadSummary();
      if (selected) await loadDetail(selected);
    } catch (e) {
      // Silent failure on auto-reload
      console.warn('[Research] Auto-reload failed:', e);
    }
  }, [loadSummary, loadDetail, selected]);

  useImperativeHandle(
    researchRef,
    () => ({
      reload,
    }),
    [reload],
  );

  const handleAddUniverse = useCallback(async () => {
    const sym = addSymbol.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(sym)) {
      setError('Ticker: letters/digits only, 1–10 chars');
      return;
    }
    setError(null);
    setUniverseBusy(true);
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
      setError(null);
      setUniverseBusy(true);
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
    // If a theme is selected, show sector ETFs for that theme
    if (selectedTheme && SECTOR_THEMES[selectedTheme]) {
      const theme = SECTOR_THEMES[selectedTheme];
      const rows: Array<{
        underlying: string;
        etf: string;
        direction: 'bull' | 'bear';
        factor: number;
        source: string;
        updatedAt: string;
        underlyingPrice: number | null;
        underlyingDayPct: number | null;
        etfPrice: number | null;
        etfDayPct: number | null;
        quoteUpdated: string | null;
      }> = [];

      const quotes = detail?.quotes ?? summary?.quotes ?? {};
      
      // Add bull ETFs
      for (const bull of theme.bull) {
        const etfQ = quotes[bull.etf];
        rows.push({
          underlying: selectedTheme,
          etf: bull.etf,
          direction: 'bull',
          factor: bull.factor,
          source: 'theme',
          updatedAt: new Date().toISOString(),
          underlyingPrice: null,
          underlyingDayPct: null,
          etfPrice: etfQ?.price ?? null,
          etfDayPct: etfQ?.dayPct ?? null,
          quoteUpdated: etfQ?.updatedAt ?? null,
        });
      }
      
      // Add bear ETFs
      for (const bear of theme.bear) {
        const etfQ = quotes[bear.etf];
        rows.push({
          underlying: selectedTheme,
          etf: bear.etf,
          direction: 'bear',
          factor: bear.factor,
          source: 'theme',
          updatedAt: new Date().toISOString(),
          underlyingPrice: null,
          underlyingDayPct: null,
          etfPrice: etfQ?.price ?? null,
          etfDayPct: etfQ?.dayPct ?? null,
          quoteUpdated: etfQ?.updatedAt ?? null,
        });
      }
      
      return rows;
    }

    // Original logic for underlying selection
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
        underlyingPrice: underQ?.price ?? selectedRow?.underlyingPrice ?? null,
        underlyingDayPct: underQ?.dayPct ?? selectedRow?.underlyingDayPct ?? null,
        etfPrice: etfQ?.price ?? null,
        etfDayPct: etfQ?.dayPct ?? null,
        quoteUpdated: etfQ?.updatedAt ?? underQ?.updatedAt ?? m.updatedAt ?? null,
      };
    });
  }, [detail, summary, selected, selectedRow, selectedTheme]);

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
      price: q?.price ?? (sym === selected ? selectedRow?.underlyingPrice ?? null : null),
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
            style={{
              opacity: busy || universeBusy ? 0.6 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {busy ? '⟳' : 'Refresh'}
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

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Inverse ETFs by theme</h3>
        <div className="ticker-row">
          {Object.entries(SECTOR_THEMES).map(([themeKey, themeData]) => {
            const primaryBull = themeData.bull[0];
            const primaryBear = themeData.bear[0];
            return (
              <div
                key={themeKey}
                className={`ticker-chip${selectedTheme === themeKey ? ' active' : ''}`}
                style={{ minWidth: 'fit-content' }}
              >
                <div className="ticker-main" style={{ padding: '8px 10px', gap: 4 }}>
                  <button
                    type="button"
                    className="ticker-select"
                    onClick={() => selectTheme(themeKey)}
                    title={`View ${themeData.name} sector ETFs`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    <span className="mono ticker-chip-symbol" style={{ fontSize: 12, fontWeight: 600 }}>
                      {themeData.name}
                    </span>
                  </button>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      type="button"
                      className="linkish mono"
                      style={{
                        fontSize: 11,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'rgba(61, 214, 140, 0.12)',
                        color: '#3dd68c',
                        textDecoration: 'none',
                        border: '1px solid rgba(61, 214, 140, 0.25)',
                      }}
                      onClick={() => selectTheme(themeKey)}
                    >
                      {primaryBull.etf} {primaryBull.factor > 0 ? `+${primaryBull.factor}x` : `${primaryBull.factor}x`}
                    </button>
                    <button
                      type="button"
                      className="linkish mono"
                      style={{
                        fontSize: 11,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'rgba(240, 113, 120, 0.12)',
                        color: '#f07178',
                        textDecoration: 'none',
                        border: '1px solid rgba(240, 113, 120, 0.25)',
                      }}
                      onClick={() => selectTheme(themeKey)}
                    >
                      {primaryBear.etf} {primaryBear.factor}x
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="caveat" role="alert">
          {error}
        </div>
      )}

      <div className="research-layout">
        <div className="research-main">
          <div className="card">
            <h3><span className="mono">{selectedTheme || selected}</span> · linked ETFs</h3>
            {selectedTheme ? (
              <p className="muted">Theme view selected. Click a ticker in the Universe to see specific ETF mappings.</p>
            ) : selectedRow ? (
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
                    <div className="stat-label">Underlying</div>
                    <div style={{ marginTop: 4 }}>
                      <div className="stat-value" style={{ fontSize: 18 }}>
                        {fmtMoney(selectedRow.underlyingPrice)}
                      </div>
                      <div className={pnlClass(selectedRow.underlyingDayPct)} style={{ fontSize: 14 }}>
                        {fmtPct(selectedRow.underlyingDayPct)}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="stat-label">Bull ETF</div>
                    <div style={{ marginTop: 4 }}>
                      <div className="stat-value" style={{ fontSize: 18 }}>
                        {fmtMoney(selectedRow.bullPrice)}
                      </div>
                      <div className={pnlClass(selectedRow.bullDayPct)} style={{ fontSize: 14 }}>
                        {fmtPct(selectedRow.bullDayPct)}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="stat-label">Bear ETF</div>
                    <div style={{ marginTop: 4 }}>
                      <div className="stat-value" style={{ fontSize: 18 }}>
                        {fmtMoney(selectedRow.bearPrice)}
                      </div>
                      <div className={pnlClass(selectedRow.bearDayPct)} style={{ fontSize: 14 }}>
                        {fmtPct(selectedRow.bearDayPct)}
                      </div>
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
              ETF map · quotes · <span className="mono">{selectedTheme || selected}</span>
            </h3>
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
              {selectedTheme
                ? `Sector ETFs for ${selectedTheme} theme`
                : 'All known bull and bear single-stock ETFs for the selected underlying (not the full universe). Click a row to focus the info panel.'}
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="left">Direction</th>
                    <th className="left">ETF</th>
                    <th>Factor</th>
                    <th>ETF Price</th>
                    <th>ETF Day %</th>
                    <th>Under. Price</th>
                    <th>Under. Day %</th>
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
                      <td className="mono">{fmtMoney(r.etfPrice)}</td>
                      <td className={pnlClass(r.etfDayPct)}>{fmtPct(r.etfDayPct)}</td>
                      <td className="mono">{fmtMoney(r.underlyingPrice)}</td>
                      <td className={pnlClass(r.underlyingDayPct)}>{fmtPct(r.underlyingDayPct)}</td>
                      <td className="left muted">{r.source || '—'}</td>
                      <td className="muted">{fmtTime(r.quoteUpdated)}</td>
                    </tr>
                  ))}
                  {!selectedEtfTableRows.length && (
                    <tr>
                      <td colSpan={9} className="left muted">
                        {selectedTheme
                          ? `No ETFs available for ${selectedTheme} theme.`
                          : `No bull/bear ETFs mapped for ${selected} yet. Click Refresh.`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <PriceChartCard chartData={chartData} chartSymbols={chartSymbols} selected={selected} />
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
                  <div style={{ marginTop: 8 }}>
                    <div className="stat-label">Price</div>
                    <div className="stat-value" style={{ fontSize: 20, marginTop: 4 }}>
                      {fmtMoney(focusInfo.price)}
                    </div>
                    <div className={pnlClass(focusInfo.dayPct)} style={{ fontSize: 16, marginTop: 2 }}>
                      {fmtPct(focusInfo.dayPct)}
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

          <NewsCard symbol={selected} detail={detail} />
        </div>
      </div>
    </div>
  );
}
