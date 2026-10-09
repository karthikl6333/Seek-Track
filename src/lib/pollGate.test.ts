import { describe, expect, it } from 'vitest';
import { createThrottle, createTtlValue, PAPER_SYNC_MIN_MS, paperSyncTargets } from './pollGate';
import { newestMarkStamp } from './refreshStamp';

describe('paperSyncTargets (background Alpaca sync gating)', () => {
  const base = { hidden: false, nowMs: 1_000_000, lastSyncMs: null as number | null };

  it('Overview syncs all three books; each paper tab only its own; other views none', () => {
    expect(paperSyncTargets('overview', base)).toEqual(['paper', 'cryptoPaper', 'paperFlex']);
    expect(paperSyncTargets('paper', base)).toEqual(['paper']);
    expect(paperSyncTargets('cryptoPaper', base)).toEqual(['cryptoPaper']);
    expect(paperSyncTargets('paperFlex', base)).toEqual(['paperFlex']);
    expect(paperSyncTargets('trades', base)).toEqual([]);
    expect(paperSyncTargets('research', base)).toEqual([]);
  });

  it('nothing while the tab is hidden', () => {
    expect(paperSyncTargets('overview', { ...base, hidden: true })).toEqual([]);
  });

  it('at most once per 5 minutes (was every 30s cycle)', () => {
    expect(PAPER_SYNC_MIN_MS).toBe(300_000);
    expect(paperSyncTargets('overview', { ...base, lastSyncMs: base.nowMs - 299_999 })).toEqual([]);
    expect(paperSyncTargets('overview', { ...base, lastSyncMs: base.nowMs - 300_000 })).toHaveLength(3);
  });
});

describe('createThrottle (SSE-driven watchlist/research re-reads)', () => {
  it('leading call runs immediately; a burst collapses into one trailing call', () => {
    let now = 0;
    const timers: Array<{ at: number; cb: () => void }> = [];
    let runs = 0;
    const t = createThrottle(20_000, () => runs++, {
      now: () => now,
      setTimer: (cb, ms) => {
        const h = { at: now + ms, cb };
        timers.push(h);
        return h;
      },
      clearTimer: (h) => timers.splice(timers.indexOf(h as never), 1),
    });
    t.call();
    expect(runs).toBe(1);
    now = 5_000;
    t.call();
    t.call();
    t.call();
    expect(runs).toBe(1);
    expect(timers).toHaveLength(1);
    expect(timers[0].at).toBe(20_000);
    now = 20_000;
    timers.shift()!.cb();
    expect(runs).toBe(2);
    // 12 deltas in a minute → at most 4 re-reads (was 12).
  });
});

describe('createTtlValue', () => {
  it('memoizes for the TTL and reloads after it / after invalidate', async () => {
    let now = 0;
    let loads = 0;
    const v = createTtlValue(300_000, async () => ++loads, () => now);
    expect(await v.get()).toBe(1);
    now = 299_999;
    expect(await v.get()).toBe(1);
    now = 300_000;
    expect(await v.get()).toBe(2);
    v.invalidate();
    expect(await v.get()).toBe(3);
  });
});

describe('newestMarkStamp (client delta cursor for ?since=)', () => {
  it('returns the newest updatedAt, or null when empty', () => {
    expect(newestMarkStamp({})).toBeNull();
    expect(
      newestMarkStamp({
        A: { updatedAt: '2026-10-09T10:00:00.000Z' },
        B: { updatedAt: '2026-10-09T10:05:00.000Z' },
        C: { updatedAt: null },
      }),
    ).toBe('2026-10-09T10:05:00.000Z');
  });
});
