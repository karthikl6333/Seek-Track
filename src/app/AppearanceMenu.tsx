import { useState } from 'react';
import { Popover } from '../components/Popover';
import { SEASON_IDS, SEASON_THEMES, type SeasonPref, type SeasonTheme, isSeasonPref } from '../lib/seasons';

export interface AppearanceMenuProps {
  pref: SeasonPref;
  theme: SeasonTheme | null;
  onChange: (p: SeasonPref) => void;
}

/** Settings popover for the seasonal accent theme (Auto / specific season / Off). Stored in localStorage only. */
export function AppearanceMenu({ pref, theme, onChange }: AppearanceMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel="Appearance settings"
      title="Appearance"
      trigger={<span aria-hidden="true">{theme ? theme.ornament : '◐'}</span>}
    >
      <div className="popover-title">Appearance</div>
      <label className="popover-field">
        <span>Seasonal theme</span>
        <select
          value={pref}
          onChange={(e) => {
            const v = e.target.value;
            if (isSeasonPref(v)) onChange(v);
          }}
          aria-label="Seasonal theme"
        >
          <option value="auto">Auto (by date)</option>
          <option value="off">Off</option>
          {SEASON_IDS.map((id) => (
            <option key={id} value={id}>
              {SEASON_THEMES[id].ornament} {SEASON_THEMES[id].label}
            </option>
          ))}
        </select>
      </label>
      <p className="popover-note muted">
        {theme ? `Showing ${theme.label}. ` : 'Seasonal accents are off. '}
        Only accent colors change — gains stay green, losses stay red. Saved in this browser.
      </p>
    </Popover>
  );
}
