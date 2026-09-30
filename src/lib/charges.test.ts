import { describe, it, expect } from 'vitest';
import { summarizeCharges, listChargeRows } from './charges';
import type { Trade } from '../types';

describe('summarizeCharges', () => {
  it('should count NRA Tax Adj as fee charge', () => {
    const trades: Trade[] = [
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-09-29',
        action: 'NRA Tax Adj',
        symbol: 'AVL',
        description: 'NRA TAX ADJUSTMENT',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -713.12,
        importedAt: '2026-09-30T12:00:00Z',
      },
    ];

    const result = summarizeCharges(trades);
    
    expect(result.fees).toBe(713.12);
    expect(result.totalCharges).toBe(713.12);
  });

  it('should exclude Cash Dividend from charges', () => {
    const trades: Trade[] = [
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-09-29',
        action: 'Cash Dividend',
        symbol: 'AVL',
        description: 'CASH DIVIDEND',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: 2377.08,
        importedAt: '2026-09-30T12:00:00Z',
      },
    ];

    const result = summarizeCharges(trades);
    
    expect(result.fees).toBe(0);
    expect(result.totalCharges).toBe(0);
  });

  it('should handle mixed trades with tax, dividends, and regular fees', () => {
    const trades: Trade[] = [
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-09-01',
        action: 'Buy',
        symbol: 'AAPL',
        description: 'APPLE INC',
        quantity: 100,
        price: 150,
        fees: 5.00,
        amount: -15005,
        importedAt: '2026-09-01T12:00:00Z',
      },
      {
        id: '2',
        rowHash: 'hash2',
        date: '2026-09-29',
        action: 'NRA Tax Adj',
        symbol: 'AVL',
        description: 'NRA TAX ADJUSTMENT',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -713.12,
        importedAt: '2026-09-30T12:00:00Z',
      },
      {
        id: '3',
        rowHash: 'hash3',
        date: '2026-09-29',
        action: 'Cash Dividend',
        symbol: 'AVL',
        description: 'CASH DIVIDEND',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: 2377.08,
        importedAt: '2026-09-30T12:00:00Z',
      },
      {
        id: '4',
        rowHash: 'hash4',
        date: '2026-09-15',
        action: 'Margin Interest',
        symbol: '',
        description: 'MARGIN INTEREST',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -25.50,
        importedAt: '2026-09-15T12:00:00Z',
      },
    ];

    const result = summarizeCharges(trades);
    
    expect(result.fees).toBe(5.00 + 713.12);
    expect(result.marginInterest).toBe(25.50);
    expect(result.totalCharges).toBe(5.00 + 713.12 + 25.50);
  });
});

describe('listChargeRows', () => {
  it('should include NRA Tax Adj but exclude dividends', () => {
    const trades: Trade[] = [
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-09-29',
        action: 'NRA Tax Adj',
        symbol: 'AVL',
        description: 'NRA TAX ADJUSTMENT',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -713.12,
        importedAt: '2026-09-30T12:00:00Z',
      },
      {
        id: '2',
        rowHash: 'hash2',
        date: '2026-09-29',
        action: 'Cash Dividend',
        symbol: 'AVL',
        description: 'CASH DIVIDEND',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: 2377.08,
        importedAt: '2026-09-30T12:00:00Z',
      },
    ];

    const rows = listChargeRows(trades);
    
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('NRA Tax Adj');
    expect(rows[0].kind).toBe('other_charge');
    expect(rows[0].chargeAbs).toBe(713.12);
  });
});
