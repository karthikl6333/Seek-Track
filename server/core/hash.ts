import { createHash } from 'node:crypto';

/** Stable SHA-256 hex of normalized trade row fields for idempotent import. */
export function hashTradeRow(fields: {
  date: string;
  action: string;
  symbol: string;
  description: string;
  quantity: number;
  price: number;
  fees: number;
  amount: number;
}): string {
  const payload = [
    fields.date.trim(),
    fields.action.trim().toUpperCase(),
    fields.symbol.trim().toUpperCase(),
    fields.description.trim(),
    fields.quantity.toFixed(8),
    fields.price.toFixed(8),
    fields.fees.toFixed(8),
    fields.amount.toFixed(8),
  ].join('|');

  return createHash('sha256').update(payload).digest('hex');
}
