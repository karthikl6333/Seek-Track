/** Stable SHA-256 hex of normalized trade row fields for idempotent import. */
export async function hashTradeRow(fields: {
  date: string;
  action: string;
  symbol: string;
  description: string;
  quantity: number;
  price: number;
  fees: number;
  amount: number;
}): Promise<string> {
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

  const data = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
