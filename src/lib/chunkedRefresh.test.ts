import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshInChunks } from './chunkedRefresh';

afterEach(() => vi.restoreAllMocks());

describe('refreshInChunks', () => {
  const syms = Array.from({ length: 25 }, (_, i) => `S${i}`);

  it('splits into chunks of the given size, in order', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const seen: string[][] = [];
    await refreshInChunks(syms, 10, 'T', async (c) => { seen.push(c); return true; }, Boolean);
    expect(seen.map((c) => c.length)).toEqual([10, 10, 5]);
    expect(seen.flat()).toEqual(syms);
  });

  it('keeps going after a failed chunk and reports success if any chunk succeeded', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let n = 0;
    const ok = await refreshInChunks(syms, 10, 'T', async () => {
      n += 1;
      if (n === 1) throw new Error('boom');
      return n === 3;
    }, Boolean);
    expect(n).toBe(3);
    expect(ok).toBe(true);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('reports false when every chunk fails or is unsuccessful; no symbols → false, no calls', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await refreshInChunks(syms, 10, 'T', async () => { throw new Error('x'); }, Boolean)).toBe(false);
    expect(await refreshInChunks(syms, 10, 'T', async () => false, Boolean)).toBe(false);
    const fn = vi.fn();
    expect(await refreshInChunks([], 10, 'T', fn, Boolean)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });
});
