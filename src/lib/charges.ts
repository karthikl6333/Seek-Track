import type { Trade } from '../types';

export interface ChargesSummary {
  fees: number;
  marginInterest: number;
  creditInterest: number;
  totalCharges: number;
}

const MARGIN_INTEREST = /margin\s*interest/i;
const CREDIT_INTEREST = /credit\s*interest/i;
const FEE_LIKE = /\b(fee|commission|charge)\b/i;

/**
 * Sum broker charges & interest from the transaction log.
 * Fees come from Fees & Comm; margin/credit from action rows; optional
 * fee-like zero-qty rows contribute amount only when fees column is empty.
 */
export function summarizeCharges(trades: Trade[]): ChargesSummary {
  let fees = 0;
  let marginInterest = 0;
  let creditInterest = 0;

  for (const t of trades) {
    const feeAbs = Math.abs(Number(t.fees) || 0);
    if (feeAbs > 0) fees += feeAbs;

    const action = t.action ?? '';
    if (MARGIN_INTEREST.test(action)) {
      marginInterest += Math.abs(Number(t.amount) || 0);
      continue;
    }
    if (CREDIT_INTEREST.test(action)) {
      creditInterest += Number(t.amount) || 0;
      continue;
    }

    const qty = Number(t.quantity) || 0;
    const price = Number(t.price) || 0;
    const hay = `${action} ${t.description ?? ''}`;
    if (FEE_LIKE.test(hay) && qty === 0 && price === 0 && feeAbs === 0) {
      fees += Math.abs(Number(t.amount) || 0);
    }
  }

  return {
    fees,
    marginInterest,
    creditInterest,
    totalCharges: fees + marginInterest,
  };
}
