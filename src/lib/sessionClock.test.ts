import { describe, expect, it } from 'vitest';
import { formatCountdown, sessionStatusAt } from './sessionClock';

const z = (s: string) => new Date(s);

describe('sessionStatusAt', () => {
  it('regular session counts down to the 16:00 ET close', () => {
    const s = sessionStatusAt(z('2026-10-27T14:00:00Z')); // Tue 10:00 EDT
    expect(s.kind).toBe('regular');
    expect(s.label).toBe('Open');
    expect(s.nextLabel).toBe('Closes');
    expect(s.nextAt.toISOString()).toBe('2026-10-27T20:00:00.000Z');
    expect(s.msUntilNext).toBe(6 * 3_600_000);
  });

  it('pre-market counts down to the 09:30 ET open', () => {
    const s = sessionStatusAt(z('2026-10-27T12:00:00Z')); // 08:00 EDT
    expect(s.kind).toBe('premarket');
    expect(s.nextAt.toISOString()).toBe('2026-10-27T13:30:00.000Z');
    expect(s.msUntilNext).toBe(90 * 60_000);
  });

  it('after-hours counts down to 20:00 ET', () => {
    const s = sessionStatusAt(z('2026-10-27T21:00:00Z')); // 17:00 EDT
    expect(s.kind).toBe('afterhours');
    expect(s.nextAt.toISOString()).toBe('2026-10-28T00:00:00.000Z');
  });

  it('overnight between trading days is Closed until 04:00 ET', () => {
    const late = sessionStatusAt(z('2026-10-28T03:00:00Z')); // Tue 23:00 EDT
    expect(late.kind).toBe('closed');
    expect(late.nextAt.toISOString()).toBe('2026-10-28T08:00:00.000Z');
    const early = sessionStatusAt(z('2026-10-28T06:00:00Z')); // Wed 02:00 EDT
    expect(early.kind).toBe('closed');
    expect(early.nextAt.toISOString()).toBe('2026-10-28T08:00:00.000Z');
  });

  it('weekend resumes Monday 04:00 ET (after the Nov 1 DST change)', () => {
    const s = sessionStatusAt(z('2026-10-31T07:00:00Z')); // Sat
    expect(s.kind).toBe('weekend');
    expect(s.label).toBe('Weekend');
    expect(s.nextAt.toISOString()).toBe('2026-11-02T09:00:00.000Z');
  });

  it('NYSE holiday is labelled Holiday (Thanksgiving 2026)', () => {
    const s = sessionStatusAt(z('2026-11-26T15:00:00Z'));
    expect(s.kind).toBe('holiday');
    expect(s.label).toBe('Holiday');
    expect(s.nextAt.toISOString()).toBe('2026-11-27T09:00:00.000Z');
  });

  it('agrees with the auto-refresh gate at the Friday 20:00 ET boundary', () => {
    expect(sessionStatusAt(z('2026-10-31T00:30:00Z')).kind).toBe('weekend'); // Fri 20:30 EDT
    expect(sessionStatusAt(z('2026-10-30T23:30:00Z')).kind).toBe('afterhours'); // Fri 19:30 EDT
  });
});

describe('formatCountdown', () => {
  it('formats minutes, hours and days', () => {
    expect(formatCountdown(30_000)).toBe('<1m');
    expect(formatCountdown(42 * 60_000)).toBe('42m');
    expect(formatCountdown(192 * 60_000)).toBe('3h 12m');
    expect(formatCountdown((24 + 14) * 3_600_000)).toBe('1d 14h');
    expect(formatCountdown(-5)).toBe('<1m');
  });
});
