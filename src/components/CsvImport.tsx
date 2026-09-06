import { useCallback, useState } from 'react';
import type { ImportResult } from '../types';

interface Props {
  onImport: (text: string, overrideManual: boolean) => Promise<ImportResult>;
  lastResult: ImportResult | null;
}

export function CsvImport({ onImport, lastResult }: Props) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [overrideManual, setOverrideManual] = useState(true);

  const handleText = useCallback(
    async (text: string) => {
      setBusy(true);
      setMsg(null);
      try {
        const r = await onImport(text, overrideManual);
        setMsg(
          `Imported ${r.added} new row(s); skipped ${r.skipped} duplicate/empty.` +
            (r.overridden ? ` Overrode ${r.overridden} conflicting manual trade(s).` : '') +
            (r.errors.length ? ` Errors: ${r.errors.join('; ')}` : ''),
        );
      } catch (e) {
        setMsg(String(e));
      } finally {
        setBusy(false);
      }
    },
    [onImport, overrideManual],
  );

  const onFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    await handleText(text);
  };

  return (
    <div className="card">
      <h3>CSV Import (Schwab-style)</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Columns: Date, Action, Symbol, Description, Quantity, Price, Fees &amp; Comm, Amount.
        Identical CSV rows are still deduped by row hash.
      </p>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={overrideManual}
          onChange={(e) => setOverrideManual(e.target.checked)}
        />
        <span>
          Re-import overrides conflicting manual trades for symbols in this file
          <span className="muted" style={{ display: 'block', fontSize: 12 }}>
            Default ON. When checked, manual fills for symbols present in the CSV are removed so CSV
            wins; derived positions refresh after import.
          </span>
        </span>
      </label>
      <div
        className={`import-drop${drag ? ' drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void onFile(e.dataTransfer.files?.[0] ?? null);
        }}
      >
        <p style={{ margin: '0 0 10px' }}>{busy ? 'Importing…' : 'Drop CSV here or choose a file'}</p>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
        />
        <div style={{ marginTop: 10 }}>
          <a href="/sample-trades.csv" download>
            Download sample CSV
          </a>
        </div>
      </div>
      {(msg || lastResult) && (
        <p className="mono" style={{ marginBottom: 0, fontSize: 13 }}>
          {msg ??
            (lastResult
              ? `Last import: +${lastResult.added}, skipped ${lastResult.skipped}` +
                (lastResult.overridden ? `, overrode ${lastResult.overridden} manual` : '')
              : null)}
        </p>
      )}
    </div>
  );
}
