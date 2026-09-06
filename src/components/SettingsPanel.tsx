import { useState } from 'react';
import type { AppSettings, PairDef, ThemeDef } from '../types';
import { DEFAULT_SETTINGS } from '../lib/pairs';

interface Props {
  settings: AppSettings;
  onSave: (s: AppSettings) => Promise<void>;
}

export function SettingsPanel({ settings, onSave }: Props) {
  const [pairsText, setPairsText] = useState(JSON.stringify(settings.pairs, null, 2));
  const [themesText, setThemesText] = useState(JSON.stringify(settings.themes, null, 2));
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    try {
      const pairs = JSON.parse(pairsText) as PairDef[];
      const themes = JSON.parse(themesText) as ThemeDef[];
      await onSave({ pairs, themes, hiddenSymbols: settings.hiddenSymbols ?? [] });
      setMsg('Saved pair map & themes.');
    } catch (e) {
      setMsg(`Invalid JSON: ${String(e)}`);
    }
  };

  const reset = async () => {
    setPairsText(JSON.stringify(DEFAULT_SETTINGS.pairs, null, 2));
    setThemesText(JSON.stringify(DEFAULT_SETTINGS.themes, null, 2));
    await onSave({
      ...structuredClone(DEFAULT_SETTINGS),
      hiddenSymbols: settings.hiddenSymbols ?? [],
    });
    setMsg('Reset to defaults (kept hidden symbols).');
  };

  return (
    <div className="card">
      <h3>Pair Map &amp; Themes (editable)</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
        Seed defaults (SNDQ/MULL/MUZ/AVL/AVS/PLTZ) are a starting cache only — not an allow-list. Use
        Calculator &quot;Resolve pair&quot; to discover other leveraged/inverse single-stock ETFs
        (best-effort via Yahoo name parse + <code>pair_cache</code>). Override here if discovery is
        wrong.
      </p>
      <div className="grid-2">
        <div className="field">
          <label>Pairs JSON</label>
          <textarea rows={14} className="mono" value={pairsText} onChange={(e) => setPairsText(e.target.value)} />
        </div>
        <div className="field">
          <label>Themes JSON</label>
          <textarea
            rows={14}
            className="mono"
            value={themesText}
            onChange={(e) => setThemesText(e.target.value)}
          />
        </div>
      </div>
      <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn primary" onClick={() => void save()}>
          Save
        </button>
        <button type="button" className="btn" onClick={() => void reset()}>
          Reset defaults
        </button>
      </div>
      {msg && <p className="mono" style={{ fontSize: 12 }}>{msg}</p>}
    </div>
  );
}
