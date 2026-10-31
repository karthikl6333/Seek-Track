import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetFundamentalsStateForTests,
  backoffFromRetryAfter,
  effectiveMarketCap,
  FUNDAMENTALS_BACKOFF_MAX_MS,
  FUNDAMENTALS_BACKOFF_MS,
  fetchFundamentals,
  fundamentalsBackoffActive,
  isFundamentalsDue,
  parseQuoteFundamentals,
} from './fundamentals.js';

const NOW = Date.parse('2026-10-31T10:00:00Z');
const H = 3_600_000;

describe('isFundamentalsDue (24h staleness gate)', () => {
  it('due when never fetched / unparseable', () => {
    for (const v of [null, undefined, '', 'garbage']) expect(isFundamentalsDue(v, NOW)).toBe(true);
  });
  it('not due under 24h, due at/after 24h', () => {
    expect(isFundamentalsDue(new Date(NOW - 23.9 * H).toISOString(), NOW)).toBe(false);
    expect(isFundamentalsDue(new Date(NOW - 24 * H).toISOString(), NOW)).toBe(true);
    expect(isFundamentalsDue(new Date(NOW - 72 * H), NOW)).toBe(true);
  });
  it('a future timestamp (clock skew) is treated as fresh', () => {
    expect(isFundamentalsDue(new Date(NOW + H).toISOString(), NOW)).toBe(false);
  });
});

describe('effectiveMarketCap (derived-cap fallback)', () => {
  it('scales the stored cap by the live price move since fetch (moves intraday)', () => {
    expect(effectiveMarketCap({ last: 330, marketCap: 1.5e12, capPrice: 300, sharesOutstanding: 5e9 })).toBeCloseTo(1.65e12, 0);
  });
  it('stored cap as-is without a live price or price-at-fetch', () => {
    expect(effectiveMarketCap({ last: null, marketCap: 1.5e12, capPrice: 300, sharesOutstanding: null })).toBe(1.5e12);
    expect(effectiveMarketCap({ last: 330, marketCap: 1.5e12, capPrice: null, sharesOutstanding: null })).toBe(1.5e12);
  });
  it('no stored cap: live price x shares', () => {
    expect(effectiveMarketCap({ last: 100, marketCap: null, capPrice: null, sharesOutstanding: 2e9 })).toBe(2e11);
  });
  it('null when nothing usable (never invents a value)', () => {
    expect(effectiveMarketCap({ last: 100, marketCap: null, capPrice: null, sharesOutstanding: null })).toBeNull();
    expect(effectiveMarketCap({ last: null, marketCap: null, capPrice: null, sharesOutstanding: 2e9 })).toBeNull();
    expect(effectiveMarketCap({ last: 100, marketCap: 0, capPrice: 0, sharesOutstanding: 0 })).toBeNull();
  });
});

describe('parseQuoteFundamentals', () => {
  it('maps v7 results; prefers shortName, falls back to longName; drops junk numbers', () => {
    const out = parseQuoteFundamentals({
      quoteResponse: {
        result: [
          { symbol: 'avgo', shortName: 'Broadcom Inc.', marketCap: 1.5e12, sharesOutstanding: 4.7e9, regularMarketPrice: 320 },
          { symbol: 'MU', longName: 'Micron Technology, Inc.', marketCap: 'x', regularMarketPrice: 100 },
          { nope: true },
        ],
      },
    });
    expect(out).toEqual([
      { symbol: 'AVGO', name: 'Broadcom Inc.', marketCap: 1.5e12, sharesOutstanding: 4.7e9, capPrice: 320 },
      { symbol: 'MU', name: 'Micron Technology, Inc.', marketCap: null, sharesOutstanding: null, capPrice: 100 },
    ]);
  });
  it('unknown shapes -> []', () => {
    expect(parseQuoteFundamentals(null)).toEqual([]);
    expect(parseQuoteFundamentals({ quoteResponse: { result: null } })).toEqual([]);
  });
});

describe('backoffFromRetryAfter', () => {
  it('default, clamped to [30min, 6h]', () => {
    expect(backoffFromRetryAfter(null, NOW)).toBe(FUNDAMENTALS_BACKOFF_MS);
    expect(backoffFromRetryAfter('10', NOW)).toBe(FUNDAMENTALS_BACKOFF_MS);
    expect(backoffFromRetryAfter('7200', NOW)).toBe(7_200_000);
    expect(backoffFromRetryAfter('999999', NOW)).toBe(FUNDAMENTALS_BACKOFF_MAX_MS);
    expect(backoffFromRetryAfter('nonsense', NOW)).toBe(FUNDAMENTALS_BACKOFF_MS);
  });
});

describe('fetchFundamentals', () => {
  beforeEach(() => __resetFundamentalsStateForTests());

  it('never throws: network error -> empty map + back-off active', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await fetchFundamentals(['AVGO'], { fetchImpl, now: () => NOW });
    expect(out.size).toBe(0);
    expect(fundamentalsBackoffActive(NOW + 1000)).toBe(true);
    expect(fundamentalsBackoffActive(NOW + FUNDAMENTALS_BACKOFF_MS + 1)).toBe(false);
  });

  it('reuses the crumb across calls (cookie+crumb once)', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.startsWith('https://fc.yahoo.com')) return new Response('', { status: 404, headers: { 'set-cookie': 'A3=x; Path=/' } });
      if (url.includes('getcrumb')) return new Response('c1', { status: 200 });
      return new Response(JSON.stringify({ quoteResponse: { result: [{ symbol: 'AVGO', marketCap: 1e12 }] } }), { status: 200 });
    }) as unknown as typeof fetch;
    const a = await fetchFundamentals(['AVGO'], { fetchImpl, now: () => NOW });
    const b = await fetchFundamentals(['AVGO'], { fetchImpl, now: () => NOW + 1000 });
    expect(a.get('AVGO')?.marketCap).toBe(1e12);
    expect(b.size).toBe(1);
    expect(calls.filter((u) => u.includes('getcrumb'))).toHaveLength(1);
    expect(calls.filter((u) => u.includes('/v7/finance/quote'))).toHaveLength(2);
  });
});
