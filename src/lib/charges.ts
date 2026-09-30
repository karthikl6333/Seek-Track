import type { Trade } from '../types';

export interface ChargesSummary {
  fees: number;
  marginInterest: number;
  creditInterest: number;
  dividendIncome: number;
  totalCharges: number;
}

export type ChargeKind = 'fee' | 'margin_interest' | 'credit_interest' | 'dividend_income' | 'other_charge';

export interface ChargeRow {
  id: string;
  date: string;
  action: string;
  symbol: string;
  description: string;
  fees: number;
  amount: number;
  kind: ChargeKind;
  chargeAbs: number;
}

const MARGIN_INTEREST = /margin\s*interest/i;
const CREDIT_INTEREST = /credit\s*interest/i;
const FEE_LIKE = /\b(fee|commission|charge|tax)\b/i;
const DIVIDEND = /dividend/i;
const EXCLUDED_SYMBOLS = ['AVGO']; // Exclude AVGO dividends/taxes from charges

/**
 * Sum broker charges & interest from the transaction log.
 * Fees come from Fees & Comm; margin/credit from action rows; optional
 * fee-like zero-qty rows contribute amount only when fees column is empty.
 * After-tax dividend income (excludes AVGO) reduces total charges.
 */
export function summarizeCharges(trades: Trade[]): ChargesSummary {
  let fees = 0;
  let marginInterest = 0;
  let creditInterest = 0;
  let dividendIncome = 0;

  for (const t of trades) {
    const symbol = (t.symbol ?? '').toUpperCase();
    const isExcluded = EXCLUDED_SYMBOLS.includes(symbol);
    
    const feeAbs = Math.abs(Number(t.fees) || 0);
    if (feeAbs > 0) fees += feeAbs;

    const action = t.action ?? '';
    const amount = Number(t.amount) || 0;
    
    if (MARGIN_INTEREST.test(action)) {
      marginInterest += Math.abs(amount);
      continue;
    }
    if (CREDIT_INTEREST.test(action)) {
      creditInterest += amount;
      continue;
    }
    
    const qty = Number(t.quantity) || 0;
    const price = Number(t.price) || 0;
    const hay = `${action} ${t.description ?? ''}`;
    
    // Skip AVGO dividends and related tax adjustments
    if (isExcluded) continue;
    
    // Dividend income (positive amount reduces charges)
    if (DIVIDEND.test(hay) && qty === 0 && price === 0 && feeAbs === 0) {
      dividendIncome += amount;
      continue;
    }
    
    // Fees, commissions, charges, taxes (including NRA Tax Adj)
    if (FEE_LIKE.test(hay) && qty === 0 && price === 0 && feeAbs === 0) {
      fees += Math.abs(amount);
    }
  }

  return {
    fees,
    marginInterest,
    creditInterest,
    dividendIncome,
    totalCharges: fees + marginInterest - dividendIncome,
  };
}

/**
 * One row per qualifying trade for the Charges page.
 * Priority: non-zero fees → fee; else margin/credit interest; else dividend/tax;
 * else fee-like zero-qty amount rows → other_charge. Never duplicates a trade.
 * Excludes AVGO dividends and related taxes.
 */
export function listChargeRows(trades: Trade[]): ChargeRow[] {
  const rows: ChargeRow[] = [];

  for (const t of trades) {
    const symbol = (t.symbol ?? '').toUpperCase();
    const isExcluded = EXCLUDED_SYMBOLS.includes(symbol);
    
    const feeAbs = Math.abs(Number(t.fees) || 0);
    const action = t.action ?? '';
    const amount = Number(t.amount) || 0;
    const fees = Number(t.fees) || 0;

    let kind: ChargeKind | null = null;
    let chargeAbs = 0;

    if (feeAbs > 0) {
      kind = 'fee';
      chargeAbs = feeAbs;
    } else if (MARGIN_INTEREST.test(action)) {
      kind = 'margin_interest';
      chargeAbs = Math.abs(amount);
    } else if (CREDIT_INTEREST.test(action)) {
      kind = 'credit_interest';
      chargeAbs = Math.abs(amount);
    } else {
      const qty = Number(t.quantity) || 0;
      const price = Number(t.price) || 0;
      const hay = `${action} ${t.description ?? ''}`;
      
      // Skip AVGO dividends and related taxes from charge rows
      if (isExcluded) continue;
      
      if (DIVIDEND.test(hay) && qty === 0 && price === 0 && feeAbs === 0) {
        kind = 'dividend_income';
        chargeAbs = Math.abs(amount);
      } else if (FEE_LIKE.test(hay) && qty === 0 && price === 0 && amount !== 0) {
        kind = 'other_charge';
        chargeAbs = Math.abs(amount);
      }
    }

    if (!kind) continue;

    rows.push({
      id: t.id,
      date: t.date,
      action,
      symbol: t.symbol ?? '',
      description: t.description ?? '',
      fees,
      amount,
      kind,
      chargeAbs,
    });
  }

  rows.sort((a, b) => {
    const da = Date.parse(a.date) || 0;
    const db = Date.parse(b.date) || 0;
    return db - da;
  });

  return rows;
}
