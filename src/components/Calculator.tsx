import { useMemo } from 'react';
import type { CalculatorState, MarkInfo, PairDef, PairResolveResult } from '../types';
import { fmtMoney, fmtPct, pnlClass } from '../lib/format';
import { impliedEtfPct, impliedUnderlyingPct } from '../lib/pairs';

interface Props {
  calc: CalculatorState;
  setCalc: (c: CalculatorState) => void;
  whatIf: { pnl: number; pnlPct: number; costBasis: number };
  resolvedPair: PairResolveResult | null;
  pairBusy: boolean;
  onResolvePair: () => void;
  markDetails: Record<string, MarkInfo>;
  marks: Record<string, number>;
  settingsPairs: PairDef[];
}

function findPair(
  symbol: string,
  resolved: PairResolveResult | null,
  settingsPairs: PairDef[] | undefined,
): { pair: PairDef; side: 'etf' | 'underlying' } | null {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  if (resolved?.pair) {
    if (resolved.as === 'etf' || resolved.pair.etf === sym) {
      return { pair: resolved.pair, side: 'etf' };
    }
    if (resolved.as === 'underlying' || resolved.pair.underlying === sym) {
      return { pair: resolved.pair, side: 'underlying' };
    }
  }
  const fromSettings = settingsPairs?.find(
    (p) => p.etf.toUpperCase() === sym || p.underlying.toUpperCase() === sym,
  );
  if (fromSettings) {
    return {
      pair: fromSettings,
      side: fromSettings.etf.toUpperCase() === sym ? 'etf' : 'underlying',
    };
  }
  return null;
}

export function Calculator({
  calc,
  setCalc,
  whatIf,
  resolvedPair,
  pairBusy,
  onResolvePair,
  markDetails,
  marks,
  settingsPairs,
}: Props) {
  const set = (patch: Partial<CalculatorState>) => setCalc({ ...calc, ...patch });

  const live = marks[calc.symbol.toUpperCase()];
  const liveInfo = markDetails[calc.symbol.toUpperCase()];

  const leverage = useMemo(() => {
    if (resolvedPair?.pair) {
      const pair = resolvedPair.pair;
      const side: 'etf' | 'underlying' =
        resolvedPair.as === 'underlying' ||
        pair.underlying.toUpperCase() === calc.symbol.trim().toUpperCase()
          ? 'underlying'
          : 'etf';
      return { pair, side };
    }
    return findPair(calc.symbol, resolvedPair, settingsPairs);
  }, [calc.symbol, resolvedPair, settingsPairs]);

  const move = useMemo(() => {
    if (!leverage || !calc.entryPrice || !calc.targetPrice) return null;
    const { pair, side } = leverage;
    const selectedPct = ((calc.targetPrice - calc.entryPrice) / calc.entryPrice) * 100;

    if (side === 'etf') {
      const underPct = impliedUnderlyingPct(selectedPct, pair.factor);
      if (underPct === null) return null;
      const underMark = marks[pair.underlying] ?? null;
      const underEst =
        underMark !== null ? underMark * (1 + underPct / 100) : null;
      return {
        selectedPct,
        otherPct: underPct,
        otherLabel: pair.underlying,
        selectedLabel: pair.etf,
        otherEstPrice: underEst,
        otherMark: underMark,
        direction: 'etf→under' as const,
      };
    }

    const etfPct = impliedEtfPct(selectedPct, pair.factor);
    const etfMark = marks[pair.etf] ?? null;
    const etfEst = etfMark !== null ? etfMark * (1 + etfPct / 100) : null;
    return {
      selectedPct,
      otherPct: etfPct,
      otherLabel: pair.etf,
      selectedLabel: pair.underlying,
      otherEstPrice: etfEst,
      otherMark: etfMark,
      direction: 'under→etf' as const,
    };
  }, [leverage, calc.entryPrice, calc.targetPrice, marks]);

  return (
    <div className="card">
      <h3>What-if Calculator</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
        Live P&amp;L vs cost basis. Negative qty = short. Load an open position from Positions with one
        click.
      </p>
      <div className="grid-2">
        <div className="field">
          <label>Symbol</label>
          <div className="row-actions" style={{ justifyContent: 'stretch', gap: 6 }}>
            <input
              style={{ flex: 1 }}
              value={calc.symbol}
              onChange={(e) => set({ symbol: e.target.value.toUpperCase() })}
            />
            <button
              type="button"
              className="btn small"
              disabled={!calc.symbol || pairBusy}
              onClick={() => onResolvePair()}
              title="Resolve leveraged/inverse pair"
            >
              {pairBusy ? '…' : 'Resolve pair'}
            </button>
          </div>
        </div>
        <div className="field">
          <label>Quantity</label>
          <input
            type="number"
            value={calc.quantity}
            onChange={(e) => set({ quantity: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>Entry / Avg Cost</label>
          <input
            type="number"
            step="0.01"
            value={calc.entryPrice}
            onChange={(e) => set({ entryPrice: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>Fees</label>
          <input
            type="number"
            step="0.01"
            value={calc.fees}
            onChange={(e) => set({ fees: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>
            Target Price
            {live !== undefined && (
              <button
                type="button"
                className="btn small"
                style={{ marginLeft: 8 }}
                onClick={() => set({ targetPrice: live })}
              >
                Use live {fmtMoney(live, 4)}
              </button>
            )}
          </label>
          <input
            type="number"
            step="0.01"
            value={calc.targetPrice}
            onChange={(e) => set({ targetPrice: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>Cost Basis</label>
          <input readOnly className="mono" value={fmtMoney(whatIf.costBasis)} />
        </div>
      </div>

      {(live !== undefined || liveInfo) && (
        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
          Live/last {calc.symbol}: <span className="mono">{fmtMoney(live, 4)}</span>
          {liveInfo && (
            <>
              {' '}
              · {liveInfo.source} · updated{' '}
              {new Date(liveInfo.updatedAt).toLocaleString(undefined, {
                timeZone: 'Asia/Kolkata',
              })}{' '}
              IST
            </>
          )}
        </p>
      )}

      <div className="grid-2" style={{ marginTop: 8 }}>
        <div>
          <div className="stat-label">P&amp;L $</div>
          <div className={`stat-value ${pnlClass(whatIf.pnl)}`}>{fmtMoney(whatIf.pnl)}</div>
        </div>
        <div>
          <div className="stat-label">P&amp;L % of cost basis</div>
          <div className={`stat-value ${pnlClass(whatIf.pnlPct)}`}>{fmtPct(whatIf.pnlPct)}</div>
        </div>
      </div>

      {/* Prominent underlying / ETF implied move */}
      <div className="leverage-panel">
        <div className="stat-label">Underlying / ETF fluctuation (daily factor)</div>
        {leverage ? (
          <>
            <div className="leverage-headline mono">
              {move ? (
                <>
                  If {move.selectedLabel} moves {fmtPct(move.selectedPct)} → {move.otherLabel} ≈{' '}
                  {fmtPct(move.otherPct)} (daily factor {leverage.pair.factor > 0 ? '+' : ''}
                  {leverage.pair.factor}x)
                </>
              ) : (
                <>
                  {leverage.pair.etf} = {leverage.pair.factor > 0 ? '+' : ''}
                  {leverage.pair.factor}x {leverage.pair.underlying}
                  {leverage.pair.source ? ` · ${leverage.pair.source}` : ''}
                </>
              )}
            </div>
            {move && (
              <div className="grid-2" style={{ marginTop: 8 }}>
                <div>
                  <div className="stat-label">{move.selectedLabel} target move</div>
                  <div className={`mono ${pnlClass(move.selectedPct)}`}>
                    {fmtPct(move.selectedPct)}
                  </div>
                </div>
                <div>
                  <div className="stat-label">Implied {move.otherLabel} daily move</div>
                  <div className={`mono ${pnlClass(move.otherPct)}`}>{fmtPct(move.otherPct)}</div>
                </div>
                {move.otherMark !== null && move.otherEstPrice !== null && (
                  <>
                    <div>
                      <div className="stat-label">{move.otherLabel} mark</div>
                      <div className="mono">{fmtMoney(move.otherMark, 4)}</div>
                    </div>
                    <div>
                      <div className="stat-label">{move.otherLabel} est. price</div>
                      <div className="mono">{fmtMoney(move.otherEstPrice, 4)}</div>
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="caveat" style={{ marginTop: 8 }}>
              Approx daily-target check — multi-day compounding diverges from simple factor × move.
              Discovery is best-effort; override in Pair Map if wrong.
            </div>
          </>
        ) : (
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            {resolvedPair?.message ||
              'Not a known leveraged/inverse pair yet. Enter a single-stock ETF ticker and click Resolve pair.'}
          </p>
        )}
      </div>
    </div>
  );
}
