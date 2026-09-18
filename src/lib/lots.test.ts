import { describe, it, expect } from 'vitest';
import { computePositions } from './lots';
import type { Trade } from '../types';

describe('computePositions FIFO lot matching', () => {
  it('should handle same-day sell before buy correctly (DAMD repro case)', () => {
    const trades: Trade[] = [
      {
        id: '1',
        date: '2026-08-20',
        symbol: 'DAMD',
        action: 'Sell',
        quantity: 1000,
        price: 10,
        fees: 0,
        importedAt: '2026-08-20T09:00:00Z',
      },
      {
        id: '2',
        date: '2026-08-20',
        symbol: 'DAMD',
        action: 'Buy',
        quantity: 1000,
        price: 10,
        fees: 0,
        importedAt: '2026-08-20T09:01:00Z',
      },
      {
        id: '3',
        date: '2026-08-20',
        symbol: 'DAMD',
        action: 'Buy',
        quantity: 5000,
        price: 10,
        fees: 0,
        importedAt: '2026-08-20T09:02:00Z',
      },
      {
        id: '4',
        date: '2026-08-27',
        symbol: 'DAMD',
        action: 'Sell',
        quantity: 5000,
        price: 10,
        fees: 0,
        importedAt: '2026-08-27T09:00:00Z',
      },
      {
        id: '5',
        date: '2026-09-18',
        symbol: 'DAMD',
        action: 'Buy',
        quantity: 1000,
        price: 10,
        fees: 0,
        importedAt: '2026-09-18T09:00:00Z',
      },
    ];

    const result = computePositions(trades, [], {});

    expect(result.positions).toHaveLength(1);
    const damdPosition = result.positions.find((p) => p.symbol === 'DAMD');
    expect(damdPosition).toBeDefined();
    expect(damdPosition?.quantity).toBe(1000);
  });

  it('should process same-day round-trip correctly for another symbol', () => {
    const trades: Trade[] = [
      {
        id: 'a1',
        date: '2026-08-15',
        symbol: 'AAPL',
        action: 'Sell',
        quantity: 500,
        price: 150,
        fees: 1,
        importedAt: '2026-08-15T10:00:00Z',
      },
      {
        id: 'a2',
        date: '2026-08-15',
        symbol: 'AAPL',
        action: 'Buy',
        quantity: 500,
        price: 150,
        fees: 1,
        importedAt: '2026-08-15T10:01:00Z',
      },
      {
        id: 'a3',
        date: '2026-08-15',
        symbol: 'AAPL',
        action: 'Buy',
        quantity: 300,
        price: 151,
        fees: 1,
        importedAt: '2026-08-15T10:02:00Z',
      },
    ];

    const result = computePositions(trades, [], {});

    expect(result.positions).toHaveLength(1);
    const aaplPosition = result.positions.find((p) => p.symbol === 'AAPL');
    expect(aaplPosition).toBeDefined();
    expect(aaplPosition?.quantity).toBe(300);
  });

  it('should handle short positions with same-day buy to cover before sell short', () => {
    const trades: Trade[] = [
      {
        id: 's1',
        date: '2026-07-01',
        symbol: 'TSLA',
        action: 'Buy to Cover',
        quantity: 100,
        price: 250,
        fees: 0,
        importedAt: '2026-07-01T10:00:00Z',
      },
      {
        id: 's2',
        date: '2026-07-01',
        symbol: 'TSLA',
        action: 'Sell Short',
        quantity: 100,
        price: 250,
        fees: 0,
        importedAt: '2026-07-01T10:01:00Z',
      },
      {
        id: 's3',
        date: '2026-07-01',
        symbol: 'TSLA',
        action: 'Sell Short',
        quantity: 200,
        price: 240,
        fees: 0,
        importedAt: '2026-07-01T10:02:00Z',
      },
    ];

    const result = computePositions(trades, [], {});

    expect(result.positions).toHaveLength(1);
    const tslaPosition = result.positions.find((p) => p.symbol === 'TSLA');
    expect(tslaPosition).toBeDefined();
    expect(tslaPosition?.quantity).toBe(-200);
  });
});
