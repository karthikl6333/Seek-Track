import { describe, expect, it } from 'vitest';
import { checkedAtAfter, latestIso, refreshSucceeded } from './refreshStamp';

describe('latestIso', () => {
  it('returns the newest valid timestamp regardless of format/order', () => {
    expect(latestIso('2026-10-09T05:41:30.000Z', '2026-10-09T05:51:21Z', null)).toBe('2026-10-09T05:51:21Z');
    expect(latestIso(undefined, '2026-10-09T04:08:23.000Z', 'garbage', '')).toBe('2026-10-09T04:08:23.000Z');
    expect(latestIso(null, undefined)).toBeNull();
  });
});

describe('refreshSucceeded', () => {
  it('ok:true or a response without ok counts; ok:false / no response does not', () => {
    expect(refreshSucceeded({ ok: true })).toBe(true);
    expect(refreshSucceeded({})).toBe(true);
    expect(refreshSucceeded({ ok: false })).toBe(false);
    expect(refreshSucceeded(null)).toBe(false);
    expect(refreshSucceeded(undefined)).toBe(false);
  });
});

describe('checkedAtAfter (the HostOps 11:21:21 case)', () => {
  // Marks max(updated_at) froze at 11:11:30 IST because the 11:21:21 refresh changed nothing
  // and the server skipped the row writes.
  const pricesChangedAt = '2026-10-09T05:41:30.000Z'; // 11:11:30 IST
  const noChangeRefresh = { ok: true, updated: ['AAPL', 'GOOG'], failed: [], stale: [] };

  it('a successful refresh with no price changes still advances the stamp to the response time', () => {
    const now = new Date('2026-10-09T05:51:21.000Z'); // 11:21:21 IST
    const checked = checkedAtAfter(null, noChangeRefresh, now);
    expect(checked).toBe(now.toISOString());
    expect(latestIso(checked, pricesChangedAt)).toBe('2026-10-09T05:51:21.000Z');
  });

  it('a failed refresh does not advance the stamp', () => {
    const prev = '2026-10-09T05:41:30.000Z';
    const now = new Date('2026-10-09T05:51:21.000Z');
    expect(checkedAtAfter(prev, { ok: false }, now)).toBe(prev);
    expect(checkedAtAfter(prev, null, now)).toBe(prev);
    expect(checkedAtAfter(null, { ok: false }, now)).toBeNull();
  });

  it('never moves backwards (late response from an older request)', () => {
    const prev = '2026-10-09T05:51:21.000Z';
    expect(checkedAtAfter(prev, { ok: true }, new Date('2026-10-09T05:50:00.000Z'))).toBe(prev);
  });

  it('a newer real price change still wins over an older check', () => {
    const checked = '2026-10-09T05:51:21.000Z';
    const laterPrice = '2026-10-09T05:52:00.000Z';
    expect(latestIso(checked, laterPrice)).toBe(laterPrice);
  });
});
