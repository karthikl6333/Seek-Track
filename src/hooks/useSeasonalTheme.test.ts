import { describe, expect, it } from 'vitest';
import { applySeasonTheme } from './useSeasonalTheme';
import { SEASON_THEMES } from '../lib/seasons';

function fakeRoot() {
  const props = new Map<string, string>();
  const root = {
    style: {
      setProperty: (k: string, v: string) => void props.set(k, v),
      removeProperty: (k: string) => void props.delete(k),
    },
    dataset: {} as Record<string, string | undefined>,
  };
  return { root: root as unknown as HTMLElement, props, raw: root };
}

describe('applySeasonTheme', () => {
  it('sets accent variables and never touches gain/loss', () => {
    const { root, props, raw } = fakeRoot();
    applySeasonTheme(SEASON_THEMES.halloween, root);
    expect(props.get('--accent')).toBe(SEASON_THEMES.halloween.accent);
    expect(raw.dataset.season).toBe('halloween');
    expect([...props.keys()].some((k) => /gain|loss/.test(k))).toBe(false);
  });

  it('clears everything when the theme is off', () => {
    const { root, props, raw } = fakeRoot();
    applySeasonTheme(SEASON_THEMES.winter, root);
    applySeasonTheme(null, root);
    expect(props.size).toBe(0);
    expect(raw.dataset.season).toBeUndefined();
  });
});
