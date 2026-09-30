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
    expect(result.dividendIncome).toBe(0);
    expect(result.totalCharges).toBe(713.12);
  });

  it('should net AVL dividend income with tax to reduce charges', () => {
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
    ];

    const result = summarizeCharges(trades);
    
    // Fees: 713.12 (NRA Tax)
    // Dividend: 2377.08
    // Net: 713.12 - 2377.08 = -1663.96
    expect(result.fees).toBe(713.12);
    expect(result.dividendIncome).toBe(2377.08);
    expect(result.totalCharges).toBe(-1663.96);
  });

  it('should exclude AVGO dividends and taxes from charges', () => {
    const trades: Trade[] = [
      // AVL - should be included
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-09-29',
        action: 'Cash Dividend',
        symbol: 'AVL',
        description: '',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: 2377.08,
        importedAt: '2026-09-30T12:00:00Z',
      },
      {
        id: '2',
        rowHash: 'hash2',
        date: '2026-09-29',
        action: 'NRA Tax Adj',
        symbol: 'AVL',
        description: '',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -713.12,
        importedAt: '2026-09-30T12:00:00Z',
      },
      // AVGO - should be excluded
      {
        id: '3',
        rowHash: 'hash3',
        date: '2026-09-15',
        action: 'Qualified Dividend',
        symbol: 'AVGO',
        description: '',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: 500.00,
        importedAt: '2026-09-15T12:00:00Z',
      },
      {
        id: '4',
        rowHash: 'hash4',
        date: '2026-09-15',
        action: 'NRA Tax Adj',
        symbol: 'AVGO',
        description: '',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -75.00,
        importedAt: '2026-09-15T12:00:00Z',
      },
    ];

    const result = summarizeCharges(trades);
    
    // Only AVL should be counted
    expect(result.fees).toBe(713.12); // Only AVL tax
    expect(result.dividendIncome).toBe(2377.08); // Only AVL dividend
    expect(result.totalCharges).toBe(-1663.96); // AVL net only
  });

  it('should handle live data with AVGO exclusion', () => {
    const trades: Trade[] = [
      {
        id: 'live1',
        rowHash: 'livehash1',
        date: '2026-09-30',
        action: 'Buy',
        symbol: 'MUZ',
        description: '',
        quantity: 3000,
        price: 6.70,
        fees: 0,
        amount: -20100,
        importedAt: '2026-09-30T12:37:35.503Z',
      },
      {
        id: 'live2',
        rowHash: 'livehash2',
        date: '2026-09-29',
        action: 'NRA Tax Adj',
        symbol: 'AVL',
        description: '',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -713.12,
        importedAt: '2026-09-30T12:37:35.503Z',
      },
      {
        id: 'live3',
        rowHash: 'livehash3',
        date: '2026-09-29',
        action: 'Cash Dividend',
        symbol: 'AVL',
        description: '',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: 2377.08,
        importedAt: '2026-09-30T12:37:35.503Z',
      },
    ];

    const result = summarizeCharges(trades);
    
    expect(result.fees).toBe(713.12);
    expect(result.dividendIncome).toBe(2377.08);
    expect(result.totalCharges).toBe(-1663.96);
  });
});

describe('listChargeRows', () => {
  it('should include AVL dividend and tax, exclude AVGO', () => {
    const trades: Trade[] = [
      // AVL - should appear
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-09-29',
        action: 'Cash Dividend',
        symbol: 'AVL',
        description: '',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: 2377.08,
        importedAt: '2026-09-30T12:00:00Z',
      },
      {
        id: '2',
        rowHash: 'hash2',
        date: '2026-09-29',
        action: 'NRA Tax Adj',
        symbol: 'AVL',
        description: '',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -713.12,
        importedAt: '2026-09-30T12:00:00Z',
      },
      // AVGO - should NOT appear
      {
        id: '3',
        rowHash: 'hash3',
        date: '2026-09-15',
        action: 'Qualified Dividend',
        symbol: 'AVGO',
        description: '',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: 500.00,
        importedAt: '2026-09-15T12:00:00Z',
      },
      {
        id: '4',
        rowHash: 'hash4',
        date: '2026-09-15',
        action: 'NRA Tax Adj',
        symbol: 'AVGO',
        description: '',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -75.00,
        importedAt: '2026-09-15T12:00:00Z',
      },
    ];

    const rows = listChargeRows(trades);
    
    // Should only have 2 rows (AVL dividend + tax)
    expect(rows).toHaveLength(2);
    
    const avlDiv = rows.find(r => r.symbol === 'AVL' && r.action === 'Cash Dividend');
    expect(avlDiv).toBeDefined();
    expect(avlDiv?.kind).toBe('dividend_income');
    
    const avlTax = rows.find(r => r.symbol === 'AVL' && r.action === 'NRA Tax Adj');
    expect(avlTax).toBeDefined();
    expect(avlTax?.kind).toBe('other_charge');
    
    // AVGO rows should NOT appear
    expect(rows.find(r => r.symbol === 'AVGO')).toBeUndefined();
  });
});
