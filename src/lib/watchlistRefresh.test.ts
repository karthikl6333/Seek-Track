import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshWatchlistInChunks } from './watchlistRefresh';

afterEach(() => vi.restoreAllMocks());

const syms = Array.from({ length: 23 }, (_, i) => `S${i}`);

describe('refreshWatchlistInChunks', () => {
  it('23 symbols -> three requests of 10/10/3 (never more than 10 per request), results combined', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const sizes: number[] = [];
    const progress: Array<[number, number]> = [];
    const res = await refreshWatchlistInChunks(
      syms,
      async (chunk) => {
        sizes.push(chunk.length);
        return { ok: true, updated: chunk.slice(0, 1), failed: [], refreshedAt: `t${sizes.length}` };
      },
      (d, t) => progress.push([d, t]),
    );
    expect(sizes).toEqual([10, 10, 3]);
    expect(res).toMatchObject({ ok: true, chunksOk: 3, chunksTotal: 3, error: null, refreshedAt: 't3' });
    expect(res.updated).toEqual(['S0', 'S10', 'S20']);
    expect(progress).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
  });

  it('a throwing chunk and a server-reported error do not stop the rest; ok while any chunk succeeded', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let n = 0;
    const res = await refreshWatchlistInChunks(syms, async () => {
      n += 1;
      if (n === 1) throw new Error('boom');
      if (n === 2) return { ok: false, error: 'Too many symbols: 23 (max 10 per request)', failed: ['S10'] };
      return { ok: true, updated: ['S20'] };
    });
    expect(n).toBe(3);
    expect(res.ok).toBe(true);
    expect(res.chunksOk).toBe(1);
    expect(res.error).toBe('boom');
    expect(res.failed).toEqual(['S10']);
  });

  it('all chunks failing is not ok and keeps the first error', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await refreshWatchlistInChunks(syms, async () => {
      throw new Error('502');
    });
    expect(res).toMatchObject({ ok: false, chunksOk: 0, error: '502' });
  });

  it('dedupes/normalises symbols and makes no request for an empty list', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fn = vi.fn(async () => ({ ok: true }));
    expect((await refreshWatchlistInChunks([], fn)).ok).toBe(true);
    expect(fn).not.toHaveBeenCalled();
    await refreshWatchlistInChunks([' mu ', 'MU', 'tsla'], fn);
    expect(fn).toHaveBeenCalledWith(['MU', 'TSLA']);
  });
});
