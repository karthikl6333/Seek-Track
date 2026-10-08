import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadWatchlistSymbols } from './db';

describe('loadWatchlistSymbols', () => {
  beforeEach(() => {
    // Mock fetch globally
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should parse symbols array from API response', async () => {
    const mockResponse = {
      symbols: ['NVDA', 'AVGO', 'AMD', 'MU'],
      rows: [],
      lastRefreshAt: '2024-01-01T00:00:00Z',
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const symbols = await loadWatchlistSymbols();
    
    expect(symbols).toEqual(['NVDA', 'AVGO', 'AMD', 'MU']);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/watchlist'),
      expect.any(Object)
    );
  });

  it('should fallback to rows[].symbol if symbols array missing', async () => {
    const mockResponse = {
      rows: [
        { symbol: 'NVDA' },
        { symbol: 'AVGO' },
      ],
      lastRefreshAt: '2024-01-01T00:00:00Z',
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const symbols = await loadWatchlistSymbols();
    
    expect(symbols).toEqual(['NVDA', 'AVGO']);
  });

  it('should filter out empty symbols and TEST', async () => {
    const mockResponse = {
      symbols: ['NVDA', '', 'TEST', 'AMD', '  ', 'test'],
      rows: [],
      lastRefreshAt: '2024-01-01T00:00:00Z',
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const symbols = await loadWatchlistSymbols();
    
    expect(symbols).toEqual(['NVDA', 'AMD']);
    expect(symbols).not.toContain('');
    expect(symbols).not.toContain('TEST');
  });

  it('should normalize symbols to uppercase and trim whitespace', async () => {
    const mockResponse = {
      symbols: ['  nvda  ', 'Avgo', 'AMD'],
      rows: [],
      lastRefreshAt: '2024-01-01T00:00:00Z',
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const symbols = await loadWatchlistSymbols();
    
    expect(symbols).toEqual(['NVDA', 'AVGO', 'AMD']);
  });

  it('should return empty array if both symbols and rows are missing', async () => {
    const mockResponse = {
      lastRefreshAt: '2024-01-01T00:00:00Z',
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const symbols = await loadWatchlistSymbols();
    
    expect(symbols).toEqual([]);
  });

  it('should throw if API returns non-ok status', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Server error',
    });

    await expect(loadWatchlistSymbols()).rejects.toThrow('500 Internal Server Error');
  });

  it('should throw if API response is malformed (not an object)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => null,
    });

    // Should not throw, but return empty array (graceful degradation)
    const symbols = await loadWatchlistSymbols();
    expect(symbols).toEqual([]);
  });
});
