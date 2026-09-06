import { useMemo, useState } from 'react';
import type { MarkInfo, SymbolPosition } from '../types';
import { fmtMoney } from '../lib/format';

interface Props {
  positions: SymbolPosition[];
  marks: Record<string, number>;
  markDetails: Record<string, MarkInfo>;
  lastRefreshAt: string | null;
  onSave: (symbol: string, price: number) => Promise<void>;
  onRefresh: () => void;
}

export function MarkPrices({
  positions,
  marks,
  markDetails,
  lastRefreshAt,
  onSave,
  onRefresh,
}: Props) {
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

  const info = symbol ? markDetails[symbol] : undefined;

  return (
    <div className="card">
      <h3>Mark Prices (live + manual)</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
        Live quotes from Yahoo Finance (no API key) refresh every ~15 minutes for open symbols.
        Fallback: enter prices manually if Yahoo is blocked.
      </p>
      {lastRefreshAt && (
        <p className="muted" style={{ fontSize: 12 }}>
          Server last refresh:{' '}
          {new Date(lastRefreshAt).toLocaleString(undefined, { timeZone: 'Asia/Kolkata' })} IST
        </p>
      )}
      <div className="grid-2">
        <div className="field">
          <label>Symbol</label>
          <select value={symbol} onChange={(e) => applySymbol(e.target.value)}>
            {symbols.length === 0 && <option value="">—</option>}
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
                {marks[s] !== undefined ? ` @ ${marks[s]}` : ''}
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
          <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
            <button
              className="btn primary"
              type="button"
              disabled={!symbol}
              onClick={() => void onSave(symbol, price)}
            >
              Save mark
            </button>
            <button className="btn" type="button" onClick={onRefresh}>
              Refresh live
            </button>
          </div>
        </div>
      </div>
      {info && (
        <p className="mono" style={{ fontSize: 12, marginBottom: 0 }}>
          {symbol}: {fmtMoney(info.price, 4)} · {info.source} ·{' '}
          {new Date(info.updatedAt).toLocaleString(undefined, { timeZone: 'Asia/Kolkata' })} IST
        </p>
      )}
    </div>
  );
}
