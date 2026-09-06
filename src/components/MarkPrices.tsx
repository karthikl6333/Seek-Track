import { useMemo, useState } from 'react';
import type { SymbolPosition } from '../types';

interface Props {
  positions: SymbolPosition[];
  marks: Record<string, number>;
  onSave: (symbol: string, price: number) => Promise<void>;
}

export function MarkPrices({ positions, marks, onSave }: Props) {
  const symbols = useMemo(() => {
    const set = new Set<string>();
    positions.forEach((p) => set.add(p.symbol));
    Object.keys(marks).forEach((s) => set.add(s));
    return Array.from(set).sort();
  }, [positions, marks]);

  const [symbol, setSymbol] = useState(symbols[0] ?? '');
  const [price, setPrice] = useState(marks[symbols[0] ?? ''] ?? 0);
  const [custom, setCustom] = useState('');

  const applySymbol = (s: string) => {
    setSymbol(s);
    setPrice(marks[s] ?? 0);
  };

  return (
    <div className="card">
      <h3>Manual Mark Prices</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
        Marks drive unrealized P&amp;L. No live brokerage feed — enter prices manually.
      </p>
      <div className="grid-2">
        <div className="field">
          <label>Symbol</label>
          <select
            value={symbol}
            onChange={(e) => applySymbol(e.target.value)}
          >
            {symbols.length === 0 && <option value="">—</option>}
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Or type symbol</label>
          <input
            value={custom}
            placeholder="NEW"
            onChange={(e) => {
              const v = e.target.value.toUpperCase();
              setCustom(v);
              if (v) {
                setSymbol(v);
                setPrice(marks[v] ?? 0);
              }
            }}
          />
        </div>
        <div className="field">
          <label>Mark price</label>
          <input
            type="number"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
          />
        </div>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <label>&nbsp;</label>
          <button
            className="btn primary"
            type="button"
            disabled={!symbol}
            onClick={() => void onSave(symbol, price)}
          >
            Save mark
          </button>
        </div>
      </div>
    </div>
  );
}
