import { describe, expect, it } from 'vitest';
import { DEFAULT_PAIRS, withMappedUnderlyings } from './pairs';

describe('withMappedUnderlyings', () => {
  it('adds mapped underlyings for held leveraged ETFs', () => {
    expect(withMappedUnderlyings(['avl', 'SNDG'], DEFAULT_PAIRS).sort()).toEqual(
      ['AVGO', 'AVL', 'SNDG'].sort(),
    );
  });

  it('does not pull ETFs when only the underlying is held', () => {
    expect(withMappedUnderlyings(['AVGO'], DEFAULT_PAIRS)).toEqual(['AVGO']);
  });

  it('dedupes, drops empty/TEST, and is a no-op without pairs', () => {
    expect(withMappedUnderlyings(['AVL', 'avl', '', 'TEST'], []).sort()).toEqual(['AVL']);
    expect(withMappedUnderlyings([], DEFAULT_PAIRS)).toEqual([]);
  });
});
