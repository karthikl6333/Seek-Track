import { useCallback, useEffect, useState, useRef } from 'react';
import type { Store } from '../hooks/useStore';
import { fmtMoney, fmtPct, fmtQty, moneyTone, pnlClass } from '../lib/format';
import { summarizeCharges } from '../lib/charges';
import { loadPaperSummary, loadCryptoPaperSummary, loadPaperFlexSummary, createAlert } from '../lib/db';
import type { PaperSummary, CryptoPaperSummary, PaperFlexSummary } from '../types';
import { Watchlist, type WatchlistRef } from './Watchlist';
import { Calculator } from './Calculator';
import { CsvImport } from './CsvImport';
import { AlertManager, type AlertManagerRef } from './AlertManager';
import { TickerLink } from '../lib/yahoo';
import { STALE_AFTER_MS, staleAge } from '../lib/marks';

export function Overview({ store, watchlistRef }: { store: Store; watchlistRef?: React.RefObject<WatchlistRef> }) {
  const { analysis, settings, hiddenSet } = store;
  const [showHidden, setShowHidden] = useState(false);
  const [refreshingQuotes, setRefreshingQuotes] = useState(false);
  const [paperSummary, setPaperSummary] = useState<PaperSummary | null>(null);
  const [cryptoSummary, setCryptoSummary] = useState<CryptoPaperSummary | null>(null);
  const [paperFlexSummary, setPaperFlexSummary] = useState<PaperFlexSummary | null>(null);
  const alertManagerRef = useRef<AlertManagerRef>(null);

  const loadPaperAndCrypto = useCallback(async () => {
    try {
      const paper = await loadPaperSummary();
      setPaperSummary(paper);
    } catch {
      setPaperSummary(null);
    }
    try {
      const crypto = await loadCryptoPaperSummary();
      setCryptoSummary(crypto);
    } catch {
      setCryptoSummary(null);
    }
    try {
      const paperFlex = await loadPaperFlexSummary();
      setPaperFlexSummary(paperFlex);
    } catch {
      setPaperFlexSummary(null);
    }
  }, []);

  useEffect(() => {
    void loadPaperAndCrypto();
  }, [loadPaperAndCrypto]);

  // Reload paper/crypto summaries when marks are refreshed (e.g., global refresh button)
  useEffect(() => {
    if (store.lastRefreshAt) {
      void loadPaperAndCrypto();
    }
  }, [store.lastRefreshAt, loadPaperAndCrypto]);

  const allOpen = analysis?.positions.filter((p) => p.quantity !== 0) ?? [];
  const visibleOpen = allOpen.filter((p) => !hiddenSet.has(p.symbol.toUpperCase()));
  const hiddenOpen = allOpen.filter((p) => hiddenSet.has(p.symbol.toUpperCase()));
  const openPositions = showHidden ? allOpen : visibleOpen;

  // Totals exclude hidden symbols (unless viewing them only for display — totals stay on visible)
  const totalsPositions = visibleOpen;
  const realized =
    analysis?.positions
      .filter((p) => !hiddenSet.has(p.symbol.toUpperCase()))
      .reduce((s, p) => s + p.realizedPnl, 0) ?? 0;
  const unrealizedParts = totalsPositions.map((p) => p.unrealizedPnl);
  const hasAllMarks = totalsPositions.length > 0 && unrealizedParts.every((u) => u !== null);
  const unrealized = totalsPositions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);

  const lastUpdatedLabel = store.lastRefreshAt
    ? new Date(store.lastRefreshAt).toLocaleString(undefined, { timeZone: 'Asia/Kolkata' }) +
      ' IST'
    : totalsPositions
          .map((p) => store.markDetails[p.symbol]?.updatedAt)
          .filter(Boolean)
          .sort()
          .at(-1)
      ? new Date(
          totalsPositions
            .map((p) => store.markDetails[p.symbol]?.updatedAt)
            .filter(Boolean)
            .sort()
            .at(-1)!,
        ).toLocaleString(undefined, { timeZone: 'Asia/Kolkata' }) + ' IST'
      : null;

  // Determine market session from marks (for session indicator)
  const getMarketSession = (): string => {
    // Get session from any recent mark (they should all be from same session)
    const recentMark = totalsPositions
      .map((p) => store.markDetails[p.symbol])
      .find((m) => m?.session);
    
    if (!recentMark?.session || recentMark.session === 'unknown') {
      // Fallback: compute from current time (US/Eastern)
      const nowET = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
      const dateET = new Date(nowET);
      const hours = dateET.getHours();
      const minutes = dateET.getMinutes();
      const dayOfWeek = dateET.getDay();
      
      // Weekend = closed
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        return 'Closed';
      }
      
      // Weekday hours (Eastern Time)
      const timeMinutes = hours * 60 + minutes;
      if (timeMinutes >= 4 * 60 && timeMinutes < 9 * 60 + 30) {
        return 'Pre-market';
      } else if (timeMinutes >= 9 * 60 + 30 && timeMinutes < 16 * 60) {
        return 'Regular';
      } else if (timeMinutes >= 16 * 60 && timeMinutes < 20 * 60) {
        return 'After-hours';
      } else {
        // Before 4am or after 8pm ET
        const lastPrintTime = store.lastRefreshAt
          ? new Date(store.lastRefreshAt).toLocaleTimeString('en-US', {
              timeZone: 'America/New_York',
              hour: '2-digit',
              minute: '2-digit',
            })
          : null;
        return lastPrintTime ? `Closed — last ${lastPrintTime} ET` : 'Closed';
      }
    }
    
    // Use session from mark
    if (recentMark.session === 'premarket') return 'Pre-market';
    if (recentMark.session === 'afterhours') return 'After-hours';
    if (recentMark.session === 'regular') return 'Regular';
    return 'Closed';
  };
  
  const marketSession = getMarketSession();

  const charges = summarizeCharges(store.trades);

  const paperPnl = paperSummary?.scoreboard.totalPnl ?? 0;
  const cryptoPnl = cryptoSummary?.scoreboard.totalPnl ?? 0;
  const paperFlexPnl = paperFlexSummary?.scoreboard.totalPnl ?? 0;

  const handleAddAlert = useCallback(async (symbol: string, targetPrice: number) => {
    try {
      // Default condition: above (user can adjust in Alert Manager)
      await createAlert({
        symbol: symbol.toUpperCase(),
        targetPrice,
        condition: 'above',
      });

      // Refresh alert manager
      if (alertManagerRef.current) {
        await alertManagerRef.current.refreshAlerts();
      }

      // Show brief success feedback
      alert(`Alert created for ${symbol} @ ${fmtMoney(targetPrice, 4)}`);
    } catch (err) {
      console.error('[Overview] Failed to add alert:', err);
      alert(`Failed to create alert: ${String(err)}`);
    }
  }, []);

  return (
    <div className="stack">
      <div className="overview-stats-grid">
        <div className="card real-money">
          <span className="trading-mode-badge live">Live</span>
          <h3>Realized P&amp;L</h3>
          <div className={`stat-value ${pnlClass(realized)} ${moneyTone("stat")}`}>{fmtMoney(realized)}</div>
          <div className="stat-label">Closed lots (FIFO){hiddenOpen.length ? ' · excl. hidden' : ''}</div>
        </div>
        <div className="card real-money">
          <span className="trading-mode-badge live">Live</span>
          <h3>Unrealized P&amp;L</h3>
          <div className={`stat-value ${pnlClass(hasAllMarks ? unrealized : null)} ${moneyTone("stat")}`}>
            {hasAllMarks || totalsPositions.length === 0 ? fmtMoney(unrealized) : 'Set marks'}
          </div>
          <div className="stat-label">
            Live marks when available
            {hiddenOpen.length ? ' · excl. hidden' : ''}
            {lastUpdatedLabel ? ` · ${lastUpdatedLabel}` : ''}
          </div>
        </div>
        <button
          type="button"
          className="card stat-card-link real-money"
          onClick={() => store.setView('charges')}
          title="Open Charges tab"
        >
          <span className="trading-mode-badge live">Live</span>
          <h3>Charges</h3>
          <div className={`stat-value ${moneyTone('fee')}`}>{fmtMoney(charges.totalCharges)}</div>
          <div className="stat-label">
            Fees {fmtMoney(charges.fees)} · Margin {fmtMoney(charges.marginInterest)}
            {charges.dividendIncome !== 0 && ` · Div ${fmtMoney(charges.dividendIncome)}`}
          </div>
          {charges.creditInterest !== 0 && (
            <div className="stat-label" style={{ marginTop: 2 }}>
              Credit {fmtMoney(charges.creditInterest)}
            </div>
          )}
        </button>
        <button
          type="button"
          className="card stat-card-link paper-trading"
          onClick={() => store.setView('paper')}
          title="Open Paper tab"
        >
          <span className="trading-mode-badge paper">Paper</span>
          <h3>S0 CTRL-LRS</h3>
          <div className={`stat-value ${pnlClass(paperPnl)} ${moneyTone('stat')}`}>
            {paperSummary ? fmtMoney(paperPnl) : '—'}
          </div>
          <div className="stat-label">
            Total P&L{paperSummary?.state.equity ? ` · $${fmtMoney(paperSummary.state.equity)}` : ''}
          </div>
        </button>
        <button
          type="button"
          className="card stat-card-link paper-trading"
          onClick={() => store.setView('paperFlex')}
          title="Open Paper Flex tab"
        >
          <span className="trading-mode-badge paper">Paper</span>
          <h3>A1 FLEX ORB-DAY-ETF</h3>
          <div className={`stat-value ${pnlClass(paperFlexPnl)} ${moneyTone('stat')}`}>
            {paperFlexSummary ? fmtMoney(paperFlexPnl) : '—'}
          </div>
          <div className="stat-label">
            Total P&L{paperFlexSummary?.state.equity ? ` · $${fmtMoney(paperFlexSummary.state.equity)}` : ''}
          </div>
        </button>
        <button
          type="button"
          className="card stat-card-link paper-trading"
          onClick={() => store.setView('cryptoPaper')}
          title="Open Crypto Paper tab"
        >
          <span className="trading-mode-badge paper">Paper</span>
          <h3>C0 CTRL-SAT-V2</h3>
          <div className={`stat-value ${pnlClass(cryptoPnl)} ${moneyTone('stat')}`}>
            {cryptoSummary ? fmtMoney(cryptoPnl) : '—'}
          </div>
          <div className="stat-label">
            Total P&L{cryptoSummary?.state.equity ? ` · $${fmtMoney(cryptoSummary.state.equity)}` : ''}
          </div>
        </button>
      </div>

      <div className="overview-layout">
        <div className="stack calc-main">
          <div className="card">
            <div className="row-actions" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Holdings (open positions)</h3>
              <div className="row-actions" style={{ gap: 8 }}>
                {hiddenOpen.length > 0 && (
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => setShowHidden((v) => !v)}
                    title="Toggle rows you hid (CSV noise)"
                  >
                    {showHidden ? 'Hide hidden' : `Show hidden (${hiddenOpen.length})`}
                  </button>
                )}
                <button
                  type="button"
                  className="btn small"
                  disabled={refreshingQuotes}
                  onClick={async () => {
                    setRefreshingQuotes(true);
                    try {
                      const openSymbols = openPositions.map((p) => p.symbol);
                      await store.refreshLiveQuotes(openSymbols);
                    } catch (err) {
                      console.error('Quote refresh failed:', err);
                    } finally {
                      setRefreshingQuotes(false);
                    }
                  }}
                  title="Refresh all prices now"
                  style={{
                    opacity: refreshingQuotes ? 0.6 : 1,
                    transition: 'opacity 0.15s',
                    cursor: refreshingQuotes ? 'wait' : 'pointer',
                  }}
                >
                  {refreshingQuotes ? '⟳ Refreshing...' : '↻ Refresh prices'}
                </button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="left">Symbol</th>
                    <th>Qty</th>
                    <th>Avg cost</th>
                    <th>Current</th>
                    <th>Mkt value</th>
                    <th>Unreal. $</th>
                    <th>Unreal. %</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.map((p) => {
                    const info = store.markDetails[p.symbol];
                    const isHidden = hiddenSet.has(p.symbol.toUpperCase());
                    return (
                      <tr key={p.symbol} style={isHidden ? { opacity: 0.55 } : undefined}>
                        <td className="left">
                          <TickerLink symbol={p.symbol} />
                          {isHidden && (
                            <span className="badge" style={{ marginLeft: 6 }}>
                              hidden
                            </span>
                          )}
                          {info && (
                            <span
                              className="muted"
                              style={{ display: 'block', fontSize: 11 }}
                              title={`Last price update: ${info.updatedAt}`}
                            >
                              {info.source}
                              {(() => {
                                // Stale prices stay visible; just label their age.
                                const age = staleAge(info.updatedAt, Date.now(), STALE_AFTER_MS);
                                return age ? ` · ${age} old` : '';
                              })()}
                            </span>
                          )}
                        </td>
                        <td className="mono">{fmtQty(p.quantity)}</td>
                        <td className="mono">{fmtMoney(p.avgCost, 4)}</td>
                        <td className="mono">{fmtMoney(p.markPrice, 4)}</td>
                        <td className={moneyTone("notional")}>{fmtMoney(p.marketValue)}</td>
                        <td className={pnlClass(p.unrealizedPnl)}>{fmtMoney(p.unrealizedPnl)}</td>
                        <td className={pnlClass(p.unrealizedPnlPct)}>{fmtPct(p.unrealizedPnlPct)}</td>
                        <td>
                          <div className="row-actions" style={{ gap: 4, justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="btn small"
                              onClick={() => store.loadPositionIntoCalc(p.symbol, 'A')}
                              title="Load into Calculator A"
                            >
                              → A
                            </button>
                            <button
                              type="button"
                              className="btn small"
                              onClick={() => store.loadPositionIntoCalc(p.symbol, 'B')}
                              title="Load into Calculator B"
                            >
                              → B
                            </button>
                            <button
                              type="button"
                              className="btn small ghost"
                              onClick={() => void store.toggleHiddenSymbol(p.symbol)}
                              title={
                                isHidden
                                  ? 'Unhide this symbol from holdings totals'
                                  : 'Hide this symbol (CSV may be inaccurate)'
                              }
                            >
                              {isHidden ? 'Unhide' : 'Hide'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {openPositions.length === 0 && (
                    <tr>
                      <td className="left muted" colSpan={8}>
                        {allOpen.length > 0 && !showHidden
                          ? 'All open holdings are hidden. Click “Show hidden”.'
                          : 'No open holdings. Import CSV or add a manual trade.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {lastUpdatedLabel && (
              <p className="muted" style={{ fontSize: 12, marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>Prices last updated: {lastUpdatedLabel}</span>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 3,
                    background: marketSession.startsWith('Regular')
                      ? 'rgba(34, 197, 94, 0.15)'
                      : marketSession.startsWith('Pre-market') || marketSession.startsWith('After-hours')
                      ? 'rgba(234, 179, 8, 0.15)'
                      : 'rgba(156, 163, 175, 0.15)',
                    color: marketSession.startsWith('Regular')
                      ? '#22c55e'
                      : marketSession.startsWith('Pre-market') || marketSession.startsWith('After-hours')
                      ? '#eab308'
                      : '#9ca3af',
                    border: `1px solid ${marketSession.startsWith('Regular')
                      ? '#22c55e'
                      : marketSession.startsWith('Pre-market') || marketSession.startsWith('After-hours')
                      ? '#eab308'
                      : '#9ca3af'}`,
                  }}
                >
                  {marketSession}
                </span>
              </p>
            )}
          </div>

          <div className="dual-calculator-container">
            <Calculator
              calc={store.calcA}
              setCalc={store.setCalcA}
              whatIf={store.whatIfA}
              resolvedPair={store.resolvedPairA}
              pairBusy={store.pairBusyA}
              onResolvePair={() => void store.resolveCalcPair('A')}
              markDetails={store.markDetails}
              marks={store.marks}
              settingsPairs={settings?.pairs ?? []}
              onRefreshQuotes={() => void store.refreshLiveQuotes()}
              onAddAlert={handleAddAlert}
              compact
              slot="A"
            />
            <Calculator
              calc={store.calcB}
              setCalc={store.setCalcB}
              whatIf={store.whatIfB}
              resolvedPair={store.resolvedPairB}
              pairBusy={store.pairBusyB}
              onResolvePair={() => void store.resolveCalcPair('B')}
              markDetails={store.markDetails}
              marks={store.marks}
              settingsPairs={settings?.pairs ?? []}
              onRefreshQuotes={() => void store.refreshLiveQuotes()}
              onAddAlert={handleAddAlert}
              compact
              slot="B"
            />
          </div>

          <div className="card">
            <h3>P&amp;L by Theme</h3>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="left">Theme</th>
                    <th>Realized</th>
                    <th>Unrealized</th>
                    <th>Cost basis</th>
                    <th className="left">Symbols</th>
                  </tr>
                </thead>
                <tbody>
                  {(analysis?.themes ?? []).map((t) => (
                    <tr key={t.theme}>
                      <td className="left">{t.theme}</td>
                      <td className={pnlClass(t.realizedPnl)}>{fmtMoney(t.realizedPnl)}</td>
                      <td className={pnlClass(t.unrealizedPnl)}>{fmtMoney(t.unrealizedPnl)}</td>
                      <td className="mono">{fmtMoney(t.costBasis)}</td>
                      <td className="left muted">{t.symbols.join(', ')}</td>
                    </tr>
                  ))}
                  {(analysis?.themes.length ?? 0) === 0 && (
                    <tr>
                      <td className="left muted" colSpan={5}>
                        Import trades to see theme rollups.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="calc-side">
          <Watchlist
            compact
            watchlistRef={watchlistRef}
            openSymbols={visibleOpen.map((p) => p.symbol)}
            pairs={settings?.pairs ?? []}
          />
          <AlertManager
            ref={alertManagerRef}
            compact
            openSymbols={visibleOpen.map((p) => p.symbol)}
            watchlistSymbols={[]}
          />
          <CsvImport onImport={store.importCsvText} lastResult={store.importResult} />
        </div>
      </div>
    </div>
  );
}
