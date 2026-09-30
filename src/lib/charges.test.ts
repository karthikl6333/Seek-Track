import { describe, it, expect } from 'vitest';
import { summarizeCharges, listChargeRows } from './charges';
import type { Trade } from '../types';

describe('summarizeCharges', () => {
  // Tests from main branch (PR #65 - AVL/AVGO dividend coverage)
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

  // Tests from PR #67 - Margin/Credit Interest coverage
  it('should count margin interest from imported rows', () => {
    const trades: Trade[] = [
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-09-30',
        action: 'Margin Interest',
        symbol: '',
        description: 'Margin Interest',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -12.34,
        importedAt: '2026-09-30T10:00:00Z',
      },
      {
        id: '2',
        rowHash: 'hash2',
        date: '2026-08-28',
        action: 'Margin Interest',
        symbol: '',
        description: 'Margin Interest',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -8.50,
        importedAt: '2026-08-28T10:00:00Z',
      },
    ];

    const summary = summarizeCharges(trades);

    expect(summary.marginInterest).toBe(20.84); // 12.34 + 8.50
    expect(summary.creditInterest).toBe(0);
    expect(summary.fees).toBe(0);
    expect(summary.totalCharges).toBe(20.84);
  });

  it('should count credit interest from imported rows', () => {
    const trades: Trade[] = [
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-09-30',
        action: 'Credit Interest',
        symbol: '',
        description: 'Credit Interest',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: 5.67,
        importedAt: '2026-09-30T10:00:00Z',
      },
    ];

    const summary = summarizeCharges(trades);

    expect(summary.marginInterest).toBe(0);
    expect(summary.creditInterest).toBe(5.67);
    expect(summary.fees).toBe(0);
    expect(summary.totalCharges).toBe(0); // credit interest doesn't add to charges
  });

  it('should sum fees from trade fees column', () => {
    const trades: Trade[] = [
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-09-30',
        action: 'Buy',
        symbol: 'AAPL',
        description: 'Buy AAPL',
        quantity: 100,
        price: 150,
        fees: 1.5,
        amount: -15001.5,
        importedAt: '2026-09-30T10:00:00Z',
      },
      {
        id: '2',
        rowHash: 'hash2',
        date: '2026-09-30',
        action: 'Sell',
        symbol: 'AAPL',
        description: 'Sell AAPL',
        quantity: 100,
        price: 155,
        fees: 1.5,
        amount: 15498.5,
        importedAt: '2026-09-30T11:00:00Z',
      },
    ];

    const summary = summarizeCharges(trades);

    expect(summary.fees).toBe(3); // 1.5 + 1.5
    expect(summary.marginInterest).toBe(0);
    expect(summary.creditInterest).toBe(0);
    expect(summary.totalCharges).toBe(3);
  });

  it('should combine fees and margin interest', () => {
    const trades: Trade[] = [
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-09-30',
        action: 'Buy',
        symbol: 'AAPL',
        description: 'Buy AAPL',
        quantity: 100,
        price: 150,
        fees: 2.0,
        amount: -15002,
        importedAt: '2026-09-30T10:00:00Z',
      },
      {
        id: '2',
        rowHash: 'hash2',
        date: '2026-09-30',
        action: 'Margin Interest',
        symbol: '',
        description: 'Margin Interest',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -10.50,
        importedAt: '2026-09-30T12:00:00Z',
      },
    ];

    const summary = summarizeCharges(trades);

    expect(summary.fees).toBe(2);
    expect(summary.marginInterest).toBe(10.50);
    expect(summary.totalCharges).toBe(12.50);
  });
});

describe('listChargeRows', () => {
  // Tests from main branch (PR #65 - AVL/AVGO dividend coverage)
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

  // Tests from PR #67 - Margin/Credit Interest coverage
  it('should include margin interest rows', () => {
    const trades: Trade[] = [
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-09-30',
        action: 'Margin Interest',
        symbol: '',
        description: 'Margin Interest',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -12.34,
        importedAt: '2026-09-30T10:00:00Z',
      },
      {
        id: '2',
        rowHash: 'hash2',
        date: '2026-08-28',
        action: 'Margin Interest',
        symbol: '',
        description: 'Margin Interest',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -8.50,
        importedAt: '2026-08-28T10:00:00Z',
      },
    ];

    const rows = listChargeRows(trades);

    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe('margin_interest');
    expect(rows[0].chargeAbs).toBe(12.34);
    expect(rows[1].kind).toBe('margin_interest');
    expect(rows[1].chargeAbs).toBe(8.50);
  });

  it('should include credit interest rows', () => {
    const trades: Trade[] = [
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-09-30',
        action: 'Credit Interest',
        symbol: '',
        description: 'Credit Interest',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: 5.67,
        importedAt: '2026-09-30T10:00:00Z',
      },
    ];

    const rows = listChargeRows(trades);

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('credit_interest');
    expect(rows[0].chargeAbs).toBe(5.67);
  });

  it('should include trades with fees', () => {
    const trades: Trade[] = [
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-09-30',
        action: 'Buy',
        symbol: 'AAPL',
        description: 'Buy AAPL',
        quantity: 100,
        price: 150,
        fees: 1.5,
        amount: -15001.5,
        importedAt: '2026-09-30T10:00:00Z',
      },
    ];

    const rows = listChargeRows(trades);

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('fee');
    expect(rows[0].chargeAbs).toBe(1.5);
  });

  it('should sort by date descending (newest first)', () => {
    const trades: Trade[] = [
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-08-28',
        action: 'Margin Interest',
        symbol: '',
        description: 'Margin Interest',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -8.50,
        importedAt: '2026-08-28T10:00:00Z',
      },
      {
        id: '2',
        rowHash: 'hash2',
        date: '2026-09-30',
        action: 'Margin Interest',
        symbol: '',
        description: 'Margin Interest',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -12.34,
        importedAt: '2026-09-30T10:00:00Z',
      },
      {
        id: '3',
        rowHash: 'hash3',
        date: '2026-07-30',
        action: 'Margin Interest',
        symbol: '',
        description: 'Margin Interest',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -6.00,
        importedAt: '2026-07-30T10:00:00Z',
      },
    ];

    const rows = listChargeRows(trades);

    expect(rows).toHaveLength(3);
    expect(rows[0].date).toBe('2026-09-30');
    expect(rows[1].date).toBe('2026-08-28');
    expect(rows[2].date).toBe('2026-07-30');
  });

  it('should exclude regular trades without fees', () => {
    const trades: Trade[] = [
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-09-30',
        action: 'Buy',
        symbol: 'AAPL',
        description: 'Buy AAPL',
        quantity: 100,
        price: 150,
        fees: 0,
        amount: -15000,
        importedAt: '2026-09-30T10:00:00Z',
      },
    ];

    const rows = listChargeRows(trades);

    expect(rows).toHaveLength(0);
  });

  it('should combine all charge types in one list', () => {
    const trades: Trade[] = [
      {
        id: '1',
        rowHash: 'hash1',
        date: '2026-09-30',
        action: 'Buy',
        symbol: 'MUZ',
        description: 'Buy MUZ',
        quantity: 100,
        price: 25.50,
        fees: 1.0,
        amount: -2551,
        importedAt: '2026-09-30T10:00:00Z',
      },
      {
        id: '2',
        rowHash: 'hash2',
        date: '2026-09-30',
        action: 'Margin Interest',
        symbol: '',
        description: 'Margin Interest',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: -12.34,
        importedAt: '2026-09-30T12:00:00Z',
      },
      {
        id: '3',
        rowHash: 'hash3',
        date: '2026-09-30',
        action: 'Credit Interest',
        symbol: '',
        description: 'Credit Interest',
        quantity: 0,
        price: 0,
        fees: 0,
        amount: 5.67,
        importedAt: '2026-09-30T13:00:00Z',
      },
    ];

    const rows = listChargeRows(trades);

    expect(rows).toHaveLength(3);
    expect(rows.some(r => r.kind === 'fee')).toBe(true);
    expect(rows.some(r => r.kind === 'margin_interest')).toBe(true);
    expect(rows.some(r => r.kind === 'credit_interest')).toBe(true);
  });
});
