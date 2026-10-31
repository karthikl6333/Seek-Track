import type { Context } from 'hono';
import { query } from '../db.js';
import { randomUUID } from 'node:crypto';

const SYMBOL_RE = /^[A-Za-z0-9.\-]{1,12}$/;

export type PlanRuleType = 'target' | 'stop' | 'no-add-below' | 'deadline' | 'note';
export type PlanRuleAccount = 'real' | 'paper-s0' | 'paper-a1' | 'paper-c0';

export interface PlanRule {
  id: string;
  symbol: string;
  account: PlanRuleAccount;
  ruleType: PlanRuleType;
  priceLevel: number | null;
  deadlineDate: string | null;
  note: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DbPlanRule {
  id: string;
  symbol: string;
  account: PlanRuleAccount;
  rule_type: PlanRuleType;
  price_level: number | null;
  deadline_date: string | null;
  note: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

function normalizeSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const sym = raw.trim().toUpperCase();
  if (!SYMBOL_RE.test(sym)) return null;
  return sym;
}

function dbToRule(row: DbPlanRule): PlanRule {
  return {
    id: row.id,
    symbol: row.symbol.toUpperCase(),
    account: row.account,
    ruleType: row.rule_type,
    priceLevel: row.price_level,
    deadlineDate: row.deadline_date,
    note: row.note,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** List all active rules, optionally filtered by account */
export async function listPlanRules(account?: PlanRuleAccount): Promise<PlanRule[]> {
  const sql = account
    ? `SELECT id, symbol, account, rule_type, price_level, deadline_date, note, active, created_at, updated_at
       FROM plan_rules
       WHERE active = 1 AND account = $1
       ORDER BY symbol ASC, rule_type ASC`
    : `SELECT id, symbol, account, rule_type, price_level, deadline_date, note, active, created_at, updated_at
       FROM plan_rules
       WHERE active = 1
       ORDER BY symbol ASC, rule_type ASC`;
  
  const res = await query<DbPlanRule>(sql, account ? [account] : undefined);
  return res.rows.map(dbToRule);
}

/** Create a new plan rule */
export async function createPlanRule(input: {
  symbol: string;
  account?: PlanRuleAccount;
  ruleType: PlanRuleType;
  priceLevel?: number | null;
  deadlineDate?: string | null;
  note?: string | null;
}): Promise<PlanRule> {
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) throw new Error('Invalid symbol');

  const validTypes: PlanRuleType[] = ['target', 'stop', 'no-add-below', 'deadline', 'note'];
  if (!validTypes.includes(input.ruleType)) {
    throw new Error('Invalid rule type');
  }

  const validAccounts: PlanRuleAccount[] = ['real', 'paper-s0', 'paper-a1', 'paper-c0'];
  const account = input.account ?? 'real';
  if (!validAccounts.includes(account)) {
    throw new Error('Invalid account');
  }

  // Validation: price rules need a price level
  if (['target', 'stop', 'no-add-below'].includes(input.ruleType)) {
    if (!input.priceLevel || input.priceLevel <= 0) {
      throw new Error('Price level required and must be positive for price-based rules');
    }
  }

  // Validation: deadline rules need a date
  if (input.ruleType === 'deadline' && !input.deadlineDate) {
    throw new Error('Deadline date required for deadline rules');
  }

  const id = randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();

  await query(
    `INSERT INTO plan_rules (id, symbol, account, rule_type, price_level, deadline_date, note, active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9)`,
    [
      id,
      symbol,
      account,
      input.ruleType,
      input.priceLevel ?? null,
      input.deadlineDate ?? null,
      input.note ?? null,
      now,
      now,
    ],
  );

  return {
    id,
    symbol,
    account,
    ruleType: input.ruleType,
    priceLevel: input.priceLevel ?? null,
    deadlineDate: input.deadlineDate ?? null,
    note: input.note ?? null,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** Update an existing plan rule */
export async function updatePlanRule(
  id: string,
  updates: {
    priceLevel?: number | null;
    deadlineDate?: string | null;
    note?: string | null;
    active?: boolean;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const setClauses: string[] = ['updated_at = $1'];
  const params: unknown[] = [now];
  let paramIndex = 2;

  if (updates.priceLevel !== undefined) {
    setClauses.push(`price_level = $${paramIndex}`);
    params.push(updates.priceLevel);
    paramIndex++;
  }

  if (updates.deadlineDate !== undefined) {
    setClauses.push(`deadline_date = $${paramIndex}`);
    params.push(updates.deadlineDate);
    paramIndex++;
  }

  if (updates.note !== undefined) {
    setClauses.push(`note = $${paramIndex}`);
    params.push(updates.note);
    paramIndex++;
  }

  if (updates.active !== undefined) {
    setClauses.push(`active = $${paramIndex}`);
    params.push(updates.active ? 1 : 0);
    paramIndex++;
  }

  params.push(id);

  await query(
    `UPDATE plan_rules SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
    params,
  );
}

/** Delete a plan rule (soft delete) */
export async function deletePlanRule(id: string): Promise<void> {
  const now = new Date().toISOString();
  await query(
    `UPDATE plan_rules SET active = 0, updated_at = $1 WHERE id = $2`,
    [now, id],
  );
}

// HTTP handlers

export async function getPlanRulesHandler(c: Context) {
  try {
    const account = c.req.query('account') as PlanRuleAccount | undefined;
    const rules = await listPlanRules(account);
    return c.json({ rules });
  } catch (err) {
    console.error('[PlanRules] GET /api/plan-rules failed:', err);
    return c.json({ error: String(err) }, 500);
  }
}

export async function postPlanRulesHandler(c: Context) {
  let body: {
    symbol?: string;
    account?: PlanRuleAccount;
    ruleType?: string;
    priceLevel?: number;
    deadlineDate?: string;
    note?: string;
  } = {};

  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'JSON body required' }, 400);
  }

  if (!body.symbol || !body.ruleType) {
    return c.json({ error: 'symbol and ruleType are required' }, 400);
  }

  try {
    const rule = await createPlanRule({
      symbol: body.symbol,
      account: body.account,
      ruleType: body.ruleType as PlanRuleType,
      priceLevel: body.priceLevel,
      deadlineDate: body.deadlineDate,
      note: body.note,
    });
    return c.json({ rule });
  } catch (err) {
    console.error('[PlanRules] POST /api/plan-rules failed:', err);
    return c.json({ error: String(err) }, 400);
  }
}

export async function patchPlanRuleHandler(c: Context) {
  const id = c.req.param('id');
  if (!id) {
    return c.json({ error: 'Rule ID required' }, 400);
  }

  let body: {
    priceLevel?: number | null;
    deadlineDate?: string | null;
    note?: string | null;
    active?: boolean;
  } = {};

  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'JSON body required' }, 400);
  }

  try {
    await updatePlanRule(id, body);
    return c.json({ ok: true });
  } catch (err) {
    console.error('[PlanRules] PATCH /api/plan-rules/:id failed:', err);
    return c.json({ error: String(err) }, 500);
  }
}

export async function deletePlanRuleHandler(c: Context) {
  const id = c.req.param('id');
  if (!id) {
    return c.json({ error: 'Rule ID required' }, 400);
  }

  try {
    await deletePlanRule(id);
    return c.json({ ok: true });
  } catch (err) {
    console.error('[PlanRules] DELETE /api/plan-rules/:id failed:', err);
    return c.json({ error: String(err) }, 500);
  }
}
