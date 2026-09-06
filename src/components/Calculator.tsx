import type { CalculatorState } from '../types';
import { fmtMoney, fmtPct, pnlClass } from '../lib/format';

interface Props {
  calc: CalculatorState;
  setCalc: (c: CalculatorState) => void;
  whatIf: { pnl: number; pnlPct: number; costBasis: number };
}

export function Calculator({ calc, setCalc, whatIf }: Props) {
  const set = (patch: Partial<CalculatorState>) => setCalc({ ...calc, ...patch });

  return (
    <div className="card">
      <h3>What-if Calculator</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
        Live P&amp;L vs cost basis. Negative qty = short. Load an open position from Positions with one click.
      </p>
      <div className="grid-2">
        <div className="field">
          <label>Symbol</label>
          <input value={calc.symbol} onChange={(e) => set({ symbol: e.target.value.toUpperCase() })} />
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
          <label>Target Price</label>
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
    </div>
  );
}
