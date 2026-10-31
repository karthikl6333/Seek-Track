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

/** Display order + labels for charge kinds (shared by the filter chips and the Type column). */
export const CHARGE_KIND_ORDER: ChargeKind[] = [
  'fee',
  'margin_interest',
  'credit_interest',
  'dividend_income',
  'other_charge',
];

export const CHARGE_KIND_LABEL: Record<ChargeKind, string> = {
  fee: 'Fees & comm',
  margin_interest: 'Margin interest',
  credit_interest: 'Credit interest',
  dividend_income: 'Dividend income',
  other_charge: 'Other charge',
};

/** Kinds that reduce total charges (money in) rather than add to them. */
const CREDIT_KINDS: ReadonlySet<ChargeKind> = new Set<ChargeKind>(['dividend_income', 'credit_interest']);

/** Kinds actually present in `rows` (in display order) with their row counts. */
export function chargeKindCounts(rows: ChargeRow[]): Array<{ kind: ChargeKind; count: number }> {
  const counts = new Map<ChargeKind, number>();
  for (const r of rows) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  return CHARGE_KIND_ORDER.filter((k) => counts.has(k)).map((k) => ({ kind: k, count: counts.get(k)! }));
}

/** Keep rows whose kind is selected. An empty selection means "All". */
export function filterChargeRows(rows: ChargeRow[], selected: ReadonlySet<ChargeKind>): ChargeRow[] {
  if (selected.size === 0) return rows;
  return rows.filter((r) => selected.has(r.kind));
}

export interface ChargeTotals {
  count: number;
  /** Sum of the Fees column (as shown). */
  fees: number;
  /** Sum of the Amount column (as shown): net cash movement of the rows. */
  amount: number;
  /** Charges that cost money: fees, margin interest, other charges (always positive). */
  debits: number;
  /** Money in: dividend income + credit interest (always positive). */
  credits: number;
  /** debits − credits. Positive = net cost, negative = net credit. */
  netCharge: number;
}

/** Totals for exactly the rows passed in (i.e. the currently filtered rows). Rounded to cents. */
export function totalChargeRows(rows: ChargeRow[]): ChargeTotals {
  let fees = 0;
  let amount = 0;
  let debits = 0;
  let credits = 0;
  for (const r of rows) {
    fees += r.fees;
    amount += r.amount;
    if (CREDIT_KINDS.has(r.kind)) credits += r.chargeAbs;
    else debits += r.chargeAbs;
  }
  const c = (n: number) => Math.round(n * 100) / 100 + 0; // +0 normalises -0
  return {
    count: rows.length,
    fees: c(fees),
    amount: c(amount),
    debits: c(debits),
    credits: c(credits),
    netCharge: c(debits - credits),
  };
}
