import { useState } from 'react';
import type { ManualTradeInput } from '../types';

interface Props {
  onSubmit: (input: ManualTradeInput) => Promise<unknown>;
  defaultSymbol?: string;
}

export function AddTradeForm({ onSubmit, defaultSymbol = '' }: Props) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [action, setAction] = useState('Buy');
  const [quantity, setQuantity] = useState(100);
  const [price, setPrice] = useState(0);
  const [fees, setFees] = useState(0);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const result = (await onSubmit({
        symbol: symbol.trim().toUpperCase(),
        action,
        quantity,
        price,
        fees,
        date,
        description: 'Manual fill',
      })) as { added?: number; message?: string };
      if (result.added) {
        setMsg(`Added ${action} ${quantity} ${symbol.toUpperCase()} @ ${price}`);
      } else {
        setMsg(result.message ?? 'No new row (possible duplicate)');
      }
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>Add to existing positions</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
        Append a manual fill/trade to the ledger. Updates open lots immediately.
      </p>
      <div className="grid-2">
        <div className="field">
          <label>Symbol</label>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        </div>
        <div className="field">
          <label>Action</label>
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option>Buy</option>
            <option>Sell</option>
            <option>Sell Short</option>
            <option>Buy to Cover</option>
          </select>
        </div>
        <div className="field">
          <label>Quantity</label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>Price</label>
          <input
            type="number"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>Fees</label>
          <input
            type="number"
            step="0.01"
            value={fees}
            onChange={(e) => setFees(Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="row-actions" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !symbol || quantity <= 0}
          onClick={() => void submit()}
        >
          {busy ? 'Saving…' : 'Add trade'}
        </button>
      </div>
      {msg && (
        <p className="mono" style={{ fontSize: 12, marginBottom: 0 }}>
          {msg}
        </p>
      )}
    </div>
  );
}
