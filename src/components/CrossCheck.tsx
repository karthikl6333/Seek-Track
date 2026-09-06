import { useMemo, useState } from 'react';
import type { PairDef } from '../types';
import { impliedEtfPct, impliedUnderlyingPct } from '../lib/pairs';
import { fmtPct } from '../lib/format';

interface Props {
  pairs: PairDef[];
}

export function CrossCheck({ pairs }: Props) {
  const [etf, setEtf] = useState(pairs[0]?.etf ?? 'SNDQ');
  const [mode, setMode] = useState<'etf' | 'under'>('etf');
  const [pct, setPct] = useState(2);

  const pair = useMemo(() => pairs.find((p) => p.etf === etf) ?? pairs[0], [pairs, etf]);

  const result = useMemo(() => {
    if (!pair) return null;
    if (mode === 'etf') {
      return {
        label: `Implied ${pair.underlying} daily move`,
        value: impliedUnderlyingPct(pct, pair.factor),
      };
    }
    return {
      label: `Implied ${pair.etf} daily move`,
      value: impliedEtfPct(pct, pair.factor),
    };
  }, [pair, mode, pct]);

  if (!pair) return null;

  return (
    <div className="card">
      <h3>Bull / Bear ETF Cross-Check</h3>
      <div className="caveat">
        Approx daily-target check — uses listed daily leverage factors. Multi-day compounding diverges from
        simple factor × move.
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Pair (ETF)</label>
          <select value={etf} onChange={(e) => setEtf(e.target.value)}>
            {pairs.map((p) => (
              <option key={p.etf} value={p.etf}>
                {p.etf} = {p.factor > 0 ? '+' : ''}
                {p.factor}x {p.underlying}
                {p.optional ? ' (optional)' : ''} — {p.theme}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Input side</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'etf' | 'under')}>
            <option value="etf">Target % on ETF → implied underlying</option>
            <option value="under">Target % on underlying → implied ETF</option>
          </select>
        </div>
        <div className="field">
          <label>{mode === 'etf' ? `${pair.etf} %` : `${pair.underlying} %`}</label>
          <input type="number" step="0.1" value={pct} onChange={(e) => setPct(Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Daily factor</label>
          <input readOnly className="mono" value={`${pair.factor}x`} />
        </div>
      </div>
      <div>
        <div className="stat-label">{result?.label}</div>
        <div className="stat-value mono">{fmtPct(result?.value ?? null)}</div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        Numbers tool only — not investment advice.
      </p>
    </div>
  );
}
