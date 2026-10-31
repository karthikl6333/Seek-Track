/**
 * Lightweight D1 read-budget accounting (HostOps verification).
 *
 * Every D1 statement reports meta.rows_read / rows_written here. Totals are attributed to the
 * current route via AsyncLocalStorage (nodejs_compat), so concurrent requests in one isolate don't
 * mix. Every LOG_EVERY_REQUESTS requests the isolate logs one summary line, e.g.
 *   [ReadBudget] 200 req in 412s | total q=318 read=2911 written=40 | GET /api/marks n=60 q=60 read=410 ...
 * and each response carries `X-D1-Rows-Read` / `X-D1-Queries` headers (not for streams, whose reads
 * happen after the headers are sent; those are still counted in the summary).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestBudget {
  route: string;
  /** ?fresh=1: read through the per-isolate cache (and refill it) for this request. */
  bypassCache?: boolean;
  queries: number;
  rowsRead: number;
  rowsWritten: number;
}

interface RouteTotals {
  requests: number;
  queries: number;
  rowsRead: number;
  rowsWritten: number;
}

const als = new AsyncLocalStorage<RequestBudget>();
const totals = new Map<string, RouteTotals>();
let requestCount = 0;
let windowStart = Date.now();

export const LOG_EVERY_REQUESTS = 200;

function bucket(route: string): RouteTotals {
  let t = totals.get(route);
  if (!t) {
    t = { requests: 0, queries: 0, rowsRead: 0, rowsWritten: 0 };
    totals.set(route, t);
  }
  return t;
}

/** Normalize a request path to a route key: ids/symbols collapsed so the summary stays small. */
export function routeKey(method: string, path: string): string {
  const parts = path.split('?')[0].split('/').filter(Boolean);
  const keep = parts.slice(0, 3).map((p, i) => (i >= 2 && /[0-9]|^[A-Z.\-]{1,12}$/.test(p) ? ':id' : p));
  return `${method.toUpperCase()} /${keep.join('/')}`;
}

/** Record one executed statement (called by the D1 adapter). */
export function recordQuery(meta: { rows_read?: number; rows_written?: number } | undefined | null): void {
  const read = Number(meta?.rows_read ?? 0) || 0;
  const written = Number(meta?.rows_written ?? 0) || 0;
  const ctx = als.getStore();
  const t = bucket(ctx?.route ?? '(background)');
  t.queries++;
  t.rowsRead += read;
  t.rowsWritten += written;
  if (ctx) {
    ctx.queries++;
    ctx.rowsRead += read;
    ctx.rowsWritten += written;
  }
}

/** Run a request handler with budget attribution. */
/** True inside a request that asked for fresh data (?fresh=1). */
export function isCacheBypassed(): boolean {
  return als.getStore()?.bypassCache === true;
}

export async function withRequestBudget<T>(
  route: string,
  fn: (b: RequestBudget) => Promise<T>,
  opts: { bypassCache?: boolean } = {},
): Promise<T> {
  const budget: RequestBudget = { route, queries: 0, rowsRead: 0, rowsWritten: 0, bypassCache: opts.bypassCache };
  bucket(route).requests++;
  try {
    return await als.run(budget, () => fn(budget));
  } finally {
    requestCount++;
    if (requestCount % LOG_EVERY_REQUESTS === 0) console.log(formatSummary());
  }
}

export function formatSummary(now = Date.now()): string {
  let q = 0;
  let r = 0;
  let w = 0;
  for (const t of totals.values()) {
    q += t.queries;
    r += t.rowsRead;
    w += t.rowsWritten;
  }
  const top = Array.from(totals.entries())
    .sort((a, b) => b[1].rowsRead - a[1].rowsRead)
    .slice(0, 12)
    .map(([k, t]) => `${k} n=${t.requests} q=${t.queries} read=${t.rowsRead}`)
    .join('; ');
  const secs = Math.round((now - windowStart) / 1000);
  return `[ReadBudget] ${requestCount} req in ${secs}s | total q=${q} read=${r} written=${w} | ${top}`;
}

export function readBudgetSnapshot(): Record<string, RouteTotals> {
  return Object.fromEntries(Array.from(totals.entries()).map(([k, v]) => [k, { ...v }]));
}

export function __resetReadBudgetForTests(): void {
  totals.clear();
  requestCount = 0;
  windowStart = Date.now();
}
