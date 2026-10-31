import { useCallback, useEffect, useState } from 'react';
import {
  parseSeasonPref,
  resolveSeasonTheme,
  seasonCssVars,
  SEASON_CSS_VAR_NAMES,
  SEASON_PREF_STORAGE_KEY,
  type SeasonPref,
  type SeasonTheme,
} from '../lib/seasons';

function readPref(): SeasonPref {
  try {
    return parseSeasonPref(window.localStorage.getItem(SEASON_PREF_STORAGE_KEY));
  } catch {
    return 'auto'; // storage blocked
  }
}

/** Apply (or clear) the seasonal accent variables on <html>. Client-only: no API or D1 involvement. */
export function applySeasonTheme(theme: SeasonTheme | null, root: HTMLElement = document.documentElement) {
  for (const name of SEASON_CSS_VAR_NAMES) root.style.removeProperty(name);
  if (theme) {
    for (const [k, v] of Object.entries(seasonCssVars(theme))) root.style.setProperty(k, v);
    root.dataset.season = theme.id;
  } else {
    delete root.dataset.season;
  }
}

/** Apply the stored theme before React renders, so the first paint already has the right accent. */
export function initSeasonTheme() {
  applySeasonTheme(resolveSeasonTheme(readPref(), new Date()));
}

/** Seasonal theme preference (Auto / season / Off), persisted in localStorage and re-evaluated hourly. */
export function useSeasonalTheme() {
  const [pref, setPrefState] = useState<SeasonPref>(readPref);
  const [theme, setTheme] = useState<SeasonTheme | null>(() => resolveSeasonTheme(readPref(), new Date()));

  useEffect(() => {
    const update = () => setTheme(resolveSeasonTheme(pref, new Date()));
    update();
    const id = window.setInterval(update, 60 * 60 * 1000); // pick up a date rollover while the tab stays open
    return () => window.clearInterval(id);
  }, [pref]);

  useEffect(() => {
    applySeasonTheme(theme);
  }, [theme]);

  const setPref = useCallback((next: SeasonPref) => {
    setPrefState(next);
    try {
      window.localStorage.setItem(SEASON_PREF_STORAGE_KEY, next);
    } catch {
      /* ignore: preference just won't persist */
    }
  }, []);

  return { pref, setPref, theme };
}
