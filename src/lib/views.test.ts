import { describe, expect, it } from 'vitest';
import { NAV } from '../app/nav';
import { VALID_VIEWS, hashForView, viewFromHash } from './views';

describe('viewFromHash', () => {
  it('resolves a deep link for every tab in the nav (incl. paperFlex and cryptoPaper)', () => {
    for (const n of NAV) {
      expect(viewFromHash(`#${n.id}`)).toBe(n.id);
      expect(viewFromHash(`#/${n.id}?x=1`)).toBe(n.id);
    }
    expect(viewFromHash('#paperFlex')).toBe('paperFlex');
    expect(viewFromHash('#cryptoPaper')).toBe('cryptoPaper');
  });

  it('VALID_VIEWS and NAV list exactly the same tabs', () => {
    expect([...VALID_VIEWS].sort()).toEqual(NAV.map((n) => n.id).sort());
  });

  it('has an Ideas tab and resolves #ideas/<slug> deep links to it', () => {
    expect(NAV.some((n) => n.id === 'ideas')).toBe(true);
    expect(viewFromHash('#ideas')).toBe('ideas');
    expect(viewFromHash('#ideas/boosted-breeding-in-agriculture')).toBe('ideas');
    expect(viewFromHash('#/ideas/some-slug?x=1')).toBe('ideas');
  });

  it('hashForView keeps a deep link inside the same view and normalises everything else', () => {
    expect(hashForView('ideas', '#ideas/my-report')).toBe('#ideas/my-report');
    expect(hashForView('ideas', '#ideas')).toBe('#ideas');
    expect(hashForView('ideas', '#overview')).toBe('#ideas');
    expect(hashForView('ideas', '')).toBe('#ideas');
    expect(hashForView('overview', '#ideas/my-report')).toBe('#overview');
    expect(hashForView('ideas', '#ideasx/y')).toBe('#ideas');
  });

  it('falls back to overview for empty, unknown and prototype keys', () => {
    expect(viewFromHash('')).toBe('overview');
    expect(viewFromHash('#nope')).toBe('overview');
    expect(viewFromHash('#constructor')).toBe('overview');
  });
});
