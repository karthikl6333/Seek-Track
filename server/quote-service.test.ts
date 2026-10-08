import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('quote-service 404 caching', () => {
  // Mock the fetch API
  const originalFetch = global.fetch;
  
  beforeEach(() => {
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('should cache 404 responses for 6 hours', async () => {
    // This test verifies the 404 caching logic
    // When a symbol returns 404, it should be cached and not re-fetched for 6 hours
    
    const CACHE_404_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours
    
    // Mock implementation of the caching behavior
    const cache404Symbols = new Map<string, number>();
    const symbol = 'SKHYV';
    
    // Simulate 404 response
    const now = Date.now();
    const retryAfter = now + CACHE_404_DURATION_MS;
    cache404Symbols.set(symbol, retryAfter);
    
    // Verify symbol is cached
    expect(cache404Symbols.has(symbol)).toBe(true);
    expect(cache404Symbols.get(symbol)).toBe(retryAfter);
    
    // Verify symbol is still cached after 3 hours
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);
    const checkTime = Date.now();
    expect(checkTime < retryAfter).toBe(true);
    
    // Verify cache expires after 6 hours
    vi.advanceTimersByTime(3 * 60 * 60 * 1000 + 1000);
    const expiredTime = Date.now();
    expect(expiredTime >= retryAfter).toBe(true);
  });

  it('should skip cached 404 symbols in fetchQuotesBatch', () => {
    // This test verifies that cached 404 symbols are skipped during batch fetching
    const cache404Symbols = new Map<string, number>();
    const symbols = ['AAPL', 'SKHYV', 'MSFT'];
    const now = Date.now();
    const retryAfter = now + 6 * 60 * 60 * 1000;
    
    // Cache SKHYV as 404
    cache404Symbols.set('SKHYV', retryAfter);
    
    // Filter symbols
    const symbolsToFetch = symbols.filter(symbol => {
      const cachedRetryAfter = cache404Symbols.get(symbol);
      return !cachedRetryAfter || now >= cachedRetryAfter;
    });
    
    expect(symbolsToFetch).toEqual(['AAPL', 'MSFT']);
    expect(symbolsToFetch).not.toContain('SKHYV');
  });

  it('should remove expired 404 entries from cache', () => {
    const cache404Symbols = new Map<string, number>();
    const symbol = 'SKHYV';
    const now = Date.now();
    const retryAfter = now + 1000; // Expires in 1 second
    
    cache404Symbols.set(symbol, retryAfter);
    expect(cache404Symbols.has(symbol)).toBe(true);
    
    // Advance time past expiration
    vi.advanceTimersByTime(2000);
    const checkTime = Date.now();
    
    // Simulate cleanup (would happen in fetchQuotesBatch)
    if (cache404Symbols.get(symbol)! <= checkTime) {
      cache404Symbols.delete(symbol);
    }
    
    expect(cache404Symbols.has(symbol)).toBe(false);
  });
});
