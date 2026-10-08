import type { Context } from 'hono';
import { query } from './db.js';
import { randomUUID } from 'node:crypto';

const SYMBOL_RE = /^[A-Za-z0-9.\-]{1,12}$/;

export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: 'above' | 'below';
  status: 'active' | 'triggered' | 'deleted';
  createdAt: string;
  triggeredAt: string | null;
  lastPrice: number | null;
  notifiedAt: string | null;
}

interface DbAlert {
  id: string;
  symbol: string;
  target_price: number;
  condition: 'above' | 'below';
  status: 'active' | 'triggered' | 'deleted';
  created_at: Date | string;
  triggered_at: Date | string | null;
  last_price: number | null;
  notified_at: Date | string | null;
}

function normalizeSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const sym = raw.trim().toUpperCase();
  if (!SYMBOL_RE.test(sym)) return null;
  return sym;
}

function toISO(val: Date | string | null): string | null {
  if (!val) return null;
  return typeof val === 'string' ? val : val.toISOString();
}

function dbToAlert(row: DbAlert): PriceAlert {
  return {
    id: row.id,
    symbol: row.symbol.toUpperCase(),
    targetPrice: Number(row.target_price),
    condition: row.condition,
    status: row.status,
    createdAt: toISO(row.created_at)!,
    triggeredAt: toISO(row.triggered_at),
    lastPrice: row.last_price != null ? Number(row.last_price) : null,
    notifiedAt: toISO(row.notified_at),
  };
}

/** List all alerts (not deleted) */
export async function listAlerts(): Promise<PriceAlert[]> {
  const res = await query<DbAlert>(
    `SELECT id, symbol, target_price, condition, status, created_at, triggered_at, last_price, notified_at
     FROM price_alerts
     WHERE status != 'deleted'
     ORDER BY created_at DESC`,
  );
  return res.rows.map(dbToAlert);
}

/** Create a new alert */
export async function createAlert(input: {
  symbol: string;
  targetPrice: number;
  condition: 'above' | 'below';
}): Promise<PriceAlert> {
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) throw new Error('Invalid symbol');
  if (input.targetPrice <= 0) throw new Error('Target price must be positive');
  if (!['above', 'below'].includes(input.condition)) {
    throw new Error('Condition must be "above" or "below"');
  }

  const id = randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();

  await query(
    `INSERT INTO price_alerts (id, symbol, target_price, condition, status, created_at)
     VALUES ($1, $2, $3, $4, 'active', $5)`,
    [id, symbol, input.targetPrice, input.condition, now],
  );

  return {
    id,
    symbol,
    targetPrice: input.targetPrice,
    condition: input.condition,
    status: 'active',
    createdAt: now,
    triggeredAt: null,
    lastPrice: null,
    notifiedAt: null,
  };
}

/** Delete an alert (soft delete) */
export async function deleteAlert(id: string): Promise<void> {
  await query(
    `UPDATE price_alerts SET status = 'deleted' WHERE id = $1`,
    [id],
  );
}

/** Evaluate all active alerts against current marks */
export async function evaluateAlerts(): Promise<{
  evaluated: number;
  triggered: string[];
}> {
  // Fetch all active alerts
  const alertsRes = await query<DbAlert>(
    `SELECT id, symbol, target_price, condition, status, created_at, triggered_at, last_price, notified_at
     FROM price_alerts
     WHERE status = 'active'`,
  );

  if (alertsRes.rows.length === 0) {
    return { evaluated: 0, triggered: [] };
  }

  // Fetch current marks for all alert symbols
  const symbols = alertsRes.rows.map((a) => a.symbol.toUpperCase());
  // ANY($1) converted to IN (?, ?, ...) by db adapter
  const marksRes = await query<{ symbol: string; price: number }>(
    `SELECT symbol, price FROM marks WHERE symbol = ANY($1)`,
    [symbols],
  );
  const marks = new Map(marksRes.rows.map((r) => [r.symbol.toUpperCase(), Number(r.price)]));

  const triggered: string[] = [];
  const now = new Date().toISOString();

  for (const alert of alertsRes.rows) {
    const currentPrice = marks.get(alert.symbol.toUpperCase());
    if (currentPrice === undefined) continue; // No mark available

    let shouldTrigger = false;
    if (alert.condition === 'above' && currentPrice >= alert.target_price) {
      shouldTrigger = true;
    } else if (alert.condition === 'below' && currentPrice <= alert.target_price) {
      shouldTrigger = true;
    }

    if (shouldTrigger) {
      // Mark as triggered
      await query(
        `UPDATE price_alerts
         SET status = 'triggered', triggered_at = $1, last_price = $2
         WHERE id = $3`,
        [now, currentPrice, alert.id],
      );
      triggered.push(alert.id);

      // Send notifications
      await sendAlertNotifications({
        id: alert.id,
        symbol: alert.symbol,
        targetPrice: Number(alert.target_price),
        condition: alert.condition,
        lastPrice: currentPrice,
        triggeredAt: now,
      });

      // Mark as notified
      await query(
        `UPDATE price_alerts SET notified_at = $1 WHERE id = $2`,
        [now, alert.id],
      );
    }
  }

  return { evaluated: alertsRes.rows.length, triggered };
}

/** Send alert notifications (email + webhook) */
async function sendAlertNotifications(alert: {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: 'above' | 'below';
  lastPrice: number;
  triggeredAt: string;
}): Promise<void> {
  const { symbol, targetPrice, condition, lastPrice, triggeredAt } = alert;

  // Format timestamp in IST
  const triggeredDate = new Date(triggeredAt);
  const istTime = triggeredDate.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // 1. Send email notification
  await sendEmailNotification({
    symbol,
    targetPrice,
    condition,
    lastPrice,
    istTime,
  });

  // 2. Send webhook notification
  await sendWebhookNotification({
    symbol,
    targetPrice,
    condition,
    lastPrice,
    firedAt: triggeredAt,
  });
}

/** Send email notification via Resend or fallback to console logging */
async function sendEmailNotification(data: {
  symbol: string;
  targetPrice: number;
  condition: 'above' | 'below';
  lastPrice: number;
  istTime: string;
}): Promise<void> {
  const recipientEmail = process.env.ALERT_EMAIL_TO;
  if (!recipientEmail) {
    console.warn('[Alerts] ALERT_EMAIL_TO not configured, skipping email notification');
    return;
  }

  const { symbol, targetPrice, condition, lastPrice, istTime } = data;
  const conditionText = condition === 'above' ? 'crossed above' : 'dropped below';
  
  const subject = `🚨 Price Alert: ${symbol} ${conditionText} ${targetPrice}`;
  const textBody = `Price Alert Triggered

Symbol: ${symbol}
Condition: Price ${conditionText} ${targetPrice}
Target Price: $${targetPrice.toFixed(4)}
Last Price: $${lastPrice.toFixed(4)}
Timestamp: ${istTime} IST

This alert has been automatically triggered by Seek&Track.
`;

  const htmlBody = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
    .alert-box { background: white; padding: 15px; margin: 15px 0; border-left: 4px solid #ef4444; border-radius: 4px; }
    .label { font-weight: 600; color: #6b7280; }
    .value { font-size: 18px; font-weight: 700; color: #111827; }
    .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">🚨 Price Alert Triggered</h1>
    </div>
    <div class="content">
      <div class="alert-box">
        <p><span class="label">Symbol:</span> <span class="value">${symbol}</span></p>
        <p><span class="label">Condition:</span> Price ${conditionText} target</p>
        <p><span class="label">Target Price:</span> $${targetPrice.toFixed(4)}</p>
        <p><span class="label">Last Price:</span> <span class="value">$${lastPrice.toFixed(4)}</span></p>
        <p><span class="label">Timestamp:</span> ${istTime} IST</p>
      </div>
      <div class="footer">
        <p>This alert was automatically triggered by Seek&Track.</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  try {
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.ALERT_EMAIL_FROM || 'alerts@seek-track.com';

    if (resendApiKey) {
      // Send via Resend API
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [recipientEmail],
          subject,
          text: textBody,
          html: htmlBody,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Resend API failed: ${response.status} ${errorText}`);
      }

      const result = await response.json() as { id?: string };
      console.log('[Alerts] Email sent via Resend:', { id: result.id, to: recipientEmail });
    } else {
      // Fallback: log to console
      console.log('[Alerts] Email notification (RESEND_API_KEY not configured):');
      console.log('To:', recipientEmail);
      console.log('Subject:', subject);
      console.log('Body:', textBody);
    }
  } catch (err) {
    console.error('[Alerts] Failed to send email:', err);
  }
}

/** Send webhook notification */
async function sendWebhookNotification(data: {
  symbol: string;
  targetPrice: number;
  condition: 'above' | 'below';
  lastPrice: number;
  firedAt: string;
}): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('[Alerts] ALERT_WEBHOOK_URL not configured, skipping webhook notification');
    return;
  }

  const { symbol, targetPrice, condition, lastPrice, firedAt } = data;
  const payload = {
    symbol,
    target: targetPrice,
    direction: condition,
    lastPrice,
    firedAt,
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error('[Alerts] Webhook failed:', response.status, response.statusText);
    } else {
      console.log('[Alerts] Webhook notification sent:', payload);
    }
  } catch (err) {
    console.error('[Alerts] Failed to send webhook:', err);
  }
}

// HTTP handlers

export async function getAlertsHandler(c: Context) {
  try {
    const alerts = await listAlerts();
    return c.json({ alerts });
  } catch (err) {
    console.error('[Alerts] GET /api/alerts failed:', err);
    return c.json({ error: String(err) }, 500);
  }
}

export async function postAlertsHandler(c: Context) {
  let body: {
    symbol?: string;
    targetPrice?: number;
    condition?: string;
  } = {};

  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'JSON body required' }, 400);
  }

  if (!body.symbol || !body.targetPrice || !body.condition) {
    return c.json({ error: 'symbol, targetPrice, and condition are required' }, 400);
  }

  try {
    const alert = await createAlert({
      symbol: body.symbol,
      targetPrice: body.targetPrice,
      condition: body.condition as 'above' | 'below',
    });
    return c.json({ alert });
  } catch (err) {
    console.error('[Alerts] POST /api/alerts failed:', err);
    return c.json({ error: String(err) }, 400);
  }
}

export async function deleteAlertHandler(c: Context) {
  const id = c.req.param('id');
  if (!id) {
    return c.json({ error: 'Alert ID required' }, 400);
  }

  try {
    await deleteAlert(id);
    return c.json({ ok: true });
  } catch (err) {
    console.error('[Alerts] DELETE /api/alerts/:id failed:', err);
    return c.json({ error: String(err) }, 500);
  }
}

export async function postEvaluateAlertsHandler(c: Context) {
  try {
    const result = await evaluateAlerts();
    return c.json(result);
  } catch (err) {
    console.error('[Alerts] POST /api/alerts/evaluate failed:', err);
    return c.json({ error: String(err) }, 500);
  }
}
