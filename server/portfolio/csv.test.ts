import { describe, it, expect } from 'vitest';
import { parseSchwabCsv } from './csv.js';

describe('parseSchwabCsv', () => {
  describe('Margin Interest and Credit Interest import', () => {
    it('should import Margin Interest row with blank symbol', () => {
      const csv = [
        'Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount',
        '09/30/2026,Margin Interest,,Margin Interest,0,0,0,-12.34',
      ].join('\n');

      const { trades, result } = parseSchwabCsv(csv, new Set());

      expect(result.added).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([]);
      expect(trades).toHaveLength(1);

      const trade = trades[0];
      expect(trade.action).toBe('Margin Interest');
      expect(trade.symbol).toBe('');
      expect(trade.quantity).toBe(0);
      expect(trade.price).toBe(0);
      expect(trade.amount).toBe(-12.34);
      expect(trade.date).toBe('09/30/2026');
    });

    it('should import Credit Interest row with blank symbol', () => {
      const csv = [
        'Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount',
        '09/30/2026,Credit Interest,,Credit Interest,0,0,0,5.67',
      ].join('\n');

      const { trades, result } = parseSchwabCsv(csv, new Set());

      expect(result.added).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([]);
      expect(trades).toHaveLength(1);

      const trade = trades[0];
      expect(trade.action).toBe('Credit Interest');
      expect(trade.symbol).toBe('');
      expect(trade.quantity).toBe(0);
      expect(trade.price).toBe(0);
      expect(trade.amount).toBe(5.67);
    });

    it('should import mixed transactions including interest rows', () => {
      const csv = [
        'Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount',
        '09/30/2026,Buy,MUZ,Buy MUZ,100,25.50,1.00,-2551.00',
        '09/30/2026,Cash Dividend,AVL,Dividend,0,0,0,50.00',
        '09/30/2026,NRA Tax Adj,AVL,Tax Adjustment,0,0,0,-7.50',
        '09/30/2026,Margin Interest,,Margin Interest,0,0,0,-12.34',
      ].join('\n');

      const { trades, result } = parseSchwabCsv(csv, new Set());

      expect(result.added).toBe(4);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([]);
      expect(trades).toHaveLength(4);

      const marginInterest = trades.find(t => t.action === 'Margin Interest');
      expect(marginInterest).toBeDefined();
      expect(marginInterest?.symbol).toBe('');
      expect(marginInterest?.amount).toBe(-12.34);

      const buy = trades.find(t => t.action === 'Buy');
      expect(buy).toBeDefined();
      expect(buy?.symbol).toBe('MUZ');
    });

    it('should be idempotent on re-import using rowHash', () => {
      const csv = [
        'Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount',
        '09/30/2026,Margin Interest,,Margin Interest,0,0,0,-12.34',
      ].join('\n');

      const firstImport = parseSchwabCsv(csv, new Set());
      expect(firstImport.result.added).toBe(1);
      
      const existingHashes = new Set(firstImport.trades.map(t => t.rowHash));
      const secondImport = parseSchwabCsv(csv, existingHashes);
      
      expect(secondImport.result.added).toBe(0);
      expect(secondImport.result.skipped).toBe(1);
      expect(secondImport.trades).toHaveLength(0);
    });
  });

  describe('Non-trade action filtering', () => {
    it('should skip Wire transactions', () => {
      const csv = [
        'Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount',
        '09/30/2026,Wire Sent,,Wire Transfer,-0,0,0,-1000.00',
        '09/30/2026,Wire Received,,Wire Transfer,0,0,0,1000.00',
      ].join('\n');

      const { trades, result } = parseSchwabCsv(csv, new Set());

      expect(result.added).toBe(0);
      expect(result.skipped).toBe(2);
      expect(trades).toHaveLength(0);
    });

    it('should skip Journal entries', () => {
      const csv = [
        'Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount',
        '09/30/2026,Journal,,Journal Entry,0,0,0,100.00',
      ].join('\n');

      const { trades, result } = parseSchwabCsv(csv, new Set());

      expect(result.added).toBe(0);
      expect(result.skipped).toBe(1);
      expect(trades).toHaveLength(0);
    });

    it('should skip Cancelled transactions', () => {
      const csv = [
        'Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount',
        '09/30/2026,Buy Cancelled,AAPL,Cancelled Order,100,150.00,0,0',
      ].join('\n');

      const { trades, result } = parseSchwabCsv(csv, new Set());

      expect(result.added).toBe(0);
      expect(result.skipped).toBe(1);
      expect(trades).toHaveLength(0);
    });

    it('should skip Funds Received/Sent', () => {
      const csv = [
        'Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount',
        '09/30/2026,Funds Received,,Cash deposit,0,0,0,1000.00',
        '09/30/2026,Funds Sent,,Cash withdrawal,0,0,0,-500.00',
      ].join('\n');

      const { trades, result } = parseSchwabCsv(csv, new Set());

      expect(result.added).toBe(0);
      expect(result.skipped).toBe(2);
      expect(trades).toHaveLength(0);
    });

    it('should skip blank symbol non-interest rows', () => {
      const csv = [
        'Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount',
        '09/30/2026,Random Action,,Some description,0,0,0,100.00',
      ].join('\n');

      const { trades, result } = parseSchwabCsv(csv, new Set());

      expect(result.added).toBe(0);
      expect(result.skipped).toBe(1);
      expect(trades).toHaveLength(0);
    });
  });

  describe('Standard trade import', () => {
    it('should import Buy transactions', () => {
      const csv = [
        'Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount',
        '09/30/2026,Buy,AAPL,Buy AAPL,100,150.00,1.00,-15001.00',
      ].join('\n');

      const { trades, result } = parseSchwabCsv(csv, new Set());

      expect(result.added).toBe(1);
      expect(trades).toHaveLength(1);
      expect(trades[0].symbol).toBe('AAPL');
      expect(trades[0].action).toBe('Buy');
      expect(trades[0].quantity).toBe(100);
      expect(trades[0].price).toBe(150);
      expect(trades[0].fees).toBe(1);
    });

    it('should import Sell transactions', () => {
      const csv = [
        'Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount',
        '09/30/2026,Sell,AAPL,Sell AAPL,100,155.00,1.00,15499.00',
      ].join('\n');

      const { trades, result } = parseSchwabCsv(csv, new Set());

      expect(result.added).toBe(1);
      expect(trades).toHaveLength(1);
      expect(trades[0].symbol).toBe('AAPL');
      expect(trades[0].action).toBe('Sell');
    });

    it('should import Dividend transactions with symbol', () => {
      const csv = [
        'Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount',
        '09/30/2026,Cash Dividend,AAPL,Dividend,0,0,0,50.00',
      ].join('\n');

      const { trades, result } = parseSchwabCsv(csv, new Set());

      expect(result.added).toBe(1);
      expect(trades).toHaveLength(1);
      expect(trades[0].symbol).toBe('AAPL');
      expect(trades[0].action).toBe('Cash Dividend');
    });
  });
});
