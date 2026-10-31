import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetFundamentalsStateForTests,
  backoffFromRetryAfter,
  effectiveMarketCap,
  FUNDAMENTALS_BACKOFF_MAX_MS,
  FUNDAMENTALS_BACKOFF_MS,
  isFundamentalsDue,
  isStockLike,
  parseQuoteFundamentals,
  pickName,
  providerBackoffActive,
  setProviderBackoff,
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

describe('per-provider back-off state', () => {
  beforeEach(() => __resetFundamentalsStateForTests());
  it('backs off one provider without touching the others; lapses after the window', () => {
    setProviderBackoff('yahoo', null, NOW);
    expect(providerBackoffActive('yahoo', NOW + 1000)).toBe(true);
    expect(providerBackoffActive('nasdaq', NOW + 1000)).toBe(false);
    expect(providerBackoffActive('yahoo', NOW + FUNDAMENTALS_BACKOFF_MS + 1)).toBe(false);
  });
  it('honours Retry-After', () => {
    setProviderBackoff('nasdaq', '7200', NOW);
    expect(providerBackoffActive('nasdaq', NOW + 7_000_000)).toBe(true);
    expect(providerBackoffActive('nasdaq', NOW + 7_300_000)).toBe(false);
  });
});

describe('pickName', () => {
  it('shortName normally; longName when shortName is cut at 30 chars (ETFs share a prefix)', () => {
    expect(pickName('Broadcom Inc.', 'Broadcom Inc.')).toBe('Broadcom Inc.');
    expect(pickName('Micron Technology, Inc.', undefined)).toBe('Micron Technology, Inc.');
    expect(pickName('Defiance Daily Target 2X Short ', 'Defiance Daily Target 2X Short SMCI ETF')).toBe(
      'Defiance Daily Target 2X Short SMCI ETF',
    );
    expect(pickName(undefined, 'Only Long Name')).toBe('Only Long Name');
    expect(pickName('  ', null)).toBeNull();
  });
});

describe('isStockLike', () => {
  it('EQUITY and unknown are stock-like; ETFs/funds are not', () => {
    expect(isStockLike('EQUITY')).toBe(true);
    expect(isStockLike(null)).toBe(true);
    expect(isStockLike('ETF')).toBe(false);
    expect(isStockLike('MUTUALFUND')).toBe(false);
  });
});

describe('parseQuoteFundamentals: ETFs', () => {
  it('uses netAssets as the cap for non-equity quote types only', () => {
    const out = parseQuoteFundamentals({
      quoteResponse: {
        result: [
          { symbol: 'TSDD', quoteType: 'ETF', netAssets: 2.5e7, regularMarketPrice: 9 },
          { symbol: 'AVGO', quoteType: 'EQUITY', netAssets: 5, regularMarketPrice: 320 },
        ],
      },
    });
    expect(out[0].marketCap).toBe(2.5e7);
    expect(out[1].marketCap).toBeNull();
  });
});
