import { describe, expect, it } from 'vitest';
import { NAV } from '../app/nav';
import { VALID_VIEWS, viewFromHash } from './views';

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

  it('falls back to overview for empty, unknown and prototype keys', () => {
    expect(viewFromHash('')).toBe('overview');
    expect(viewFromHash('#nope')).toBe('overview');
    expect(viewFromHash('#constructor')).toBe('overview');
  });
});
