import { describe, it, expect } from 'vitest';
import { calcWhatIf, computePositions } from './lots';
import type { Trade } from '../types/index';

describe('computePositions FIFO lot matching', () => {
  it('should handle same-day sell before buy correctly (DAMD repro case)', () => {
    const trades: Trade[] = [
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-08-20',
        symbol: 'DAMD',
        action: 'Sell',
        description: 'Sell DAMD',
        quantity: 1000,
        price: 10,
        fees: 0,
        amount: -10000,
        importedAt: '2026-08-20T09:00:00Z',
      },
      {
        id: '2',
        rowHash: 'hash2',
        date: '2026-08-20',
        symbol: 'DAMD',
        action: 'Buy',
        description: 'Buy DAMD',
        quantity: 1000,
        price: 10,
        fees: 0,
        amount: -10000,
        importedAt: '2026-08-20T09:01:00Z',
      },
      {
        id: '3',
        rowHash: 'hash3',
        date: '2026-08-20',
        symbol: 'DAMD',
        action: 'Buy',
        description: 'Buy DAMD',
        quantity: 5000,
        price: 10,
        fees: 0,
        amount: -50000,
        importedAt: '2026-08-20T09:02:00Z',
      },
      {
        id: '4',
        rowHash: 'hash4',
        date: '2026-08-27',
        symbol: 'DAMD',
        action: 'Sell',
        description: 'Sell DAMD',
        quantity: 5000,
        price: 10,
        fees: 0,
        amount: 50000,
        importedAt: '2026-08-27T09:00:00Z',
      },
      {
        id: '5',
        rowHash: 'hash5',
        date: '2026-09-18',
        symbol: 'DAMD',
        action: 'Buy',
        description: 'Buy DAMD',
        quantity: 1000,
        price: 10,
        fees: 0,
        amount: -10000,
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
        rowHash: 'hash_a1',
        date: '2026-08-15',
        symbol: 'AAPL',
        action: 'Sell',
        description: 'Sell AAPL',
        quantity: 500,
        price: 150,
        fees: 1,
        amount: 74999,
        importedAt: '2026-08-15T10:00:00Z',
      },
      {
        id: 'a2',
        rowHash: 'hash_a2',
        date: '2026-08-15',
        symbol: 'AAPL',
        action: 'Buy',
        description: 'Buy AAPL',
        quantity: 500,
        price: 150,
        fees: 1,
        amount: -75001,
        importedAt: '2026-08-15T10:01:00Z',
      },
      {
        id: 'a3',
        rowHash: 'hash_a3',
        date: '2026-08-15',
        symbol: 'AAPL',
        action: 'Buy',
        description: 'Buy AAPL',
        quantity: 300,
        price: 151,
        fees: 1,
        amount: -45301,
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
        rowHash: 'hash_s1',
        date: '2026-07-01',
        symbol: 'TSLA',
        action: 'Buy to Cover',
        description: 'Cover TSLA',
        quantity: 100,
        price: 250,
        fees: 0,
        amount: -25000,
        importedAt: '2026-07-01T10:00:00Z',
      },
      {
        id: 's2',
        rowHash: 'hash_s2',
        date: '2026-07-01',
        symbol: 'TSLA',
        action: 'Sell Short',
        description: 'Short TSLA',
        quantity: 100,
        price: 250,
        fees: 0,
        amount: 25000,
        importedAt: '2026-07-01T10:01:00Z',
      },
      {
        id: 's3',
        rowHash: 'hash_s3',
        date: '2026-07-01',
        symbol: 'TSLA',
        action: 'Sell Short',
        description: 'Short TSLA',
        quantity: 200,
        price: 240,
        fees: 0,
        amount: 48000,
        importedAt: '2026-07-01T10:02:00Z',
      },
    ];

    const result = computePositions(trades, [], {});

    expect(result.positions).toHaveLength(1);
    const tslaPosition = result.positions.find((p) => p.symbol === 'TSLA');
    expect(tslaPosition).toBeDefined();
    expect(tslaPosition?.quantity).toBe(-200);
  });

  describe('short -> cover -> rebuy (AVL 2026-11-05 repro)', () => {
    let n = 0;
    const tr = (date: string, action: string, quantity: number, price: number, fees = 0): Trade => {
      n += 1;
      return {
        id: `avl-${n}`,
        rowHash: `avl-h${n}`,
        date,
        symbol: 'AVL',
        action,
        description: `${action} AVL`,
        quantity,
        price,
        fees,
        amount: 0,
        importedAt: `2026-11-05T15:00:${String(n).padStart(2, '0')}Z`,
      };
    };

    it('plain Buy covers an open short first; avg cost reflects only the open long lot', () => {
      const trades = [
        tr('09/14/2026', 'Buy', 12000, 34),
        tr('11/05/2026', 'Sell', 12000, 26.36, 6.52),
        tr('11/05/2026', 'Sell Short', 10000, 26.43, 5.44),
        tr('11/05/2026', 'Buy', 10000, 25.2099), // covers the short
        tr('11/05/2026', 'Buy', 10000, 25.18), // new long
      ];
      const [p] = computePositions(trades, [], {}).positions;
      expect(p.quantity).toBe(10000);
      expect(p.avgCost).toBeCloseTo(25.18, 6);
      expect(p.costBasis).toBeCloseTo(251800, 4);
      expect(p.openLots).toHaveLength(1);
      expect(p.openLots[0].quantity).toBe(10000);
      // sell 12000 long: (26.36-34)*12000 - 6.52 ; short cover: (26.43-25.2099)*10000 - 5.44
      expect(p.realizedPnl).toBeCloseTo(-7.64 * 12000 - 6.52 + 1.2201 * 10000 - 5.44, 4);
    });

    it('a Buy larger than the open short covers it and opens a long for the remainder', () => {
      const trades = [
        tr('11/01/2026', 'Sell Short', 100, 20),
        tr('11/02/2026', 'Buy', 150, 18, 3),
      ];
      const [p] = computePositions(trades, [], {}).positions;
      expect(p.quantity).toBe(50);
      expect(p.avgCost).toBeCloseTo(18, 6);
      expect(p.costBasis).toBeCloseTo(50 * 18 + 1, 6);
      expect(p.realizedPnl).toBeCloseTo(100 * 2 - 2, 6);
    });

    it('a position that returns to flat does not leak earlier costs into later lots', () => {
      const trades = [
        tr('10/01/2026', 'Buy', 100, 50),
        tr('10/02/2026', 'Sell', 100, 60),
        tr('10/03/2026', 'Buy', 10, 40),
      ];
      const [p] = computePositions(trades, [], {}).positions;
      expect(p.quantity).toBe(10);
      expect(p.avgCost).toBe(40);
    });
  });
});


describe('calcWhatIf', () => {
  it('computes long P&L with fees treated as 0 when omitted', () => {
    const r = calcWhatIf({ quantity: 100, entryPrice: 10, targetPrice: 12 });
    expect(r.costBasis).toBe(1000);
    expect(r.pnl).toBe(200);
    expect(r.pnlPct).toBeCloseTo(20, 6);
  });

  it('computes short P&L with explicit fees: 0', () => {
    const r = calcWhatIf({ quantity: -50, entryPrice: 20, fees: 0, targetPrice: 18 });
    expect(r.costBasis).toBe(1000);
    expect(r.pnl).toBe(100);
    expect(r.pnlPct).toBeCloseTo(10, 6);
  });
});
