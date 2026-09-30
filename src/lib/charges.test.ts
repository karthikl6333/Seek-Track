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

  it('should count dividend income and reduce total charges', () => {
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
    expect(result.dividendIncome).toBe(2377.08);
    expect(result.totalCharges).toBe(-2377.08);
  });

  it('should net dividend income with tax to reduce total charges', () => {
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
    
    // Fees: 5.00 (AAPL) + 713.12 (NRA Tax) = 718.12
    expect(result.fees).toBe(718.12);
    
    // Margin interest: 25.50
    expect(result.marginInterest).toBe(25.50);
    
    // Dividend income: 2377.08 (reduces charges)
    expect(result.dividendIncome).toBe(2377.08);
    
    // Total: 718.12 + 25.50 - 2377.08 = -1633.46
    expect(result.totalCharges).toBe(718.12 + 25.50 - 2377.08);
  });
});

describe('listChargeRows', () => {
  it('should include both NRA Tax Adj and dividends as separate rows', () => {
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
    
    expect(rows).toHaveLength(2);
    
    const taxRow = rows.find(r => r.action === 'NRA Tax Adj');
    expect(taxRow).toBeDefined();
    expect(taxRow?.kind).toBe('other_charge');
    expect(taxRow?.chargeAbs).toBe(713.12);
    
    const divRow = rows.find(r => r.action === 'Cash Dividend');
    expect(divRow).toBeDefined();
    expect(divRow?.kind).toBe('dividend_income');
    expect(divRow?.chargeAbs).toBe(2377.08);
  });

  it('should handle exact live data with net after-tax dividend', () => {
    const trades: Trade[] = [
      {
        id: 'live1',
        rowHash: 'livehash1',
        date: '2026-09-30',
        action: 'Buy',
        symbol: 'MUZ',
        description: 'GRANITESHARES 2X SHORT MU',
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

    const summary = summarizeCharges(trades);
    const rows = listChargeRows(trades);
    
    // Summary: Net after-tax dividend
    // Fees: 713.12 (NRA Tax)
    // Dividend income: 2377.08
    // Total: 713.12 - 2377.08 = -1663.96 (net credit)
    expect(summary.fees).toBe(713.12);
    expect(summary.dividendIncome).toBe(2377.08);
    expect(summary.totalCharges).toBe(713.12 - 2377.08);
    expect(summary.totalCharges).toBe(-1663.96);
    
    // Rows: Both NRA Tax Adj and Cash Dividend appear
    expect(rows).toHaveLength(2);
    
    const taxRow = rows.find(r => r.action === 'NRA Tax Adj');
    expect(taxRow).toBeDefined();
    expect(taxRow?.symbol).toBe('AVL');
    expect(taxRow?.amount).toBe(-713.12);
    expect(taxRow?.kind).toBe('other_charge');
    
    const divRow = rows.find(r => r.action === 'Cash Dividend');
    expect(divRow).toBeDefined();
    expect(divRow?.symbol).toBe('AVL');
    expect(divRow?.amount).toBe(2377.08);
    expect(divRow?.kind).toBe('dividend_income');
    
    // Verify Buy trade doesn't appear (has qty/price)
    expect(rows.find(r => r.action === 'Buy')).toBeUndefined();
  });
});
