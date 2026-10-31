/**
 * Plan rule notifications: email alerts for near/hit/deadline events
 * Integrates with existing Resend email infrastructure
 * 
 * Deadline checks run during quote refresh (every 30s) with daily dedupe:
 * - Each deadline event can only fire once per calendar day
 * - Uses notification log to track last notification date per rule/event
 */

import { query } from '../db.js';
import { listPlanRules, type PlanRule } from './plan-rules.js';

interface NotificationEvent {
  id: string;
  symbol: string;
  ruleType: string;
  eventType: 'near' | 'hit' | 'deadline-tomorrow' | 'deadline-today';
  priceLevel: number | null;
  lastPrice: number | null;
  deadlineDate: string | null;
  note: string | null;
}

interface NotificationLog {
  rule_id: string;
  event_type: string;
  notified_at: string;
}

const NEAR_THRESHOLD_PCT = 3; // 3% away triggers "near" alert

/**
 * Check if we've already sent this notification today (for deadlines) or ever (for price events)
 */
async function hasBeenNotifiedToday(ruleId: string, eventType: string): Promise<boolean> {
  const isDeadlineEvent = eventType.startsWith('deadline-');
  
  if (isDeadlineEvent) {
    // For deadline events, check if we've notified today (calendar day in UTC)
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const res = await query<NotificationLog>(
      `SELECT rule_id, event_type, notified_at 
       FROM plan_rule_notifications 
       WHERE rule_id = $1 AND event_type = $2 AND DATE(notified_at) = $3`,
      [ruleId, eventType, today]
    );
    return res.rows.length > 0;
  } else {
    // For price events (near/hit), check if we've ever notified
    const res = await query<NotificationLog>(
      `SELECT rule_id, event_type, notified_at 
       FROM plan_rule_notifications 
       WHERE rule_id = $1 AND event_type = $2`,
      [ruleId, eventType]
    );
    return res.rows.length > 0;
  }
}

/**
 * Mark a notification as sent
 */
async function logNotification(ruleId: string, eventType: string): Promise<void> {
  const now = new Date().toISOString();
  await query(
    `INSERT INTO plan_rule_notifications (rule_id, event_type, notified_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (rule_id, event_type) DO UPDATE SET notified_at = EXCLUDED.notified_at`,
    [ruleId, eventType, now]
  );
}

/**
 * Calculate distance status for price-based rules
 */
function calculateStatus(
  ruleType: string,
  priceLevel: number,
  lastPrice: number
): 'normal' | 'near' | 'hit' {
  const distancePct = ((lastPrice - priceLevel) / priceLevel) * 100;

  if (ruleType === 'target') {
    if (lastPrice >= priceLevel) return 'hit';
    if (distancePct > -NEAR_THRESHOLD_PCT) return 'near';
  } else if (ruleType === 'stop' || ruleType === 'no-add-below') {
    if (lastPrice <= priceLevel) return 'hit';
    if (distancePct < NEAR_THRESHOLD_PCT) return 'near';
  }

  return 'normal';
}

/**
 * Check deadline proximity
 */
function checkDeadline(deadlineDate: string): 'tomorrow' | 'today' | 'normal' {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const deadline = new Date(deadlineDate);
  deadline.setHours(0, 0, 0, 0);

  const diffMs = deadline.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  return 'normal';
}

/**
 * Evaluate all active plan rules and send notifications for events
 * Called during quote refresh (every 30s) - checks both price and deadline events
 */
export async function evaluatePlanRuleNotifications(): Promise<{
  evaluated: number;
  notified: number;
}> {
  const rules = await listPlanRules('real');
  const marks = await loadCurrentMarks();

  const events: NotificationEvent[] = [];
  let evaluated = 0;

  for (const rule of rules) {
    evaluated++;

    // Price-based rules
    if (['target', 'stop', 'no-add-below'].includes(rule.ruleType) && rule.priceLevel) {
      const lastPrice = marks.get(rule.symbol);
      if (!lastPrice) continue;

      const status = calculateStatus(rule.ruleType, rule.priceLevel, lastPrice);
      if (status === 'near') {
        const alreadyNotified = await hasBeenNotifiedToday(rule.id, 'near');
        if (!alreadyNotified) {
          events.push({
            id: rule.id,
            symbol: rule.symbol,
            ruleType: rule.ruleType,
            eventType: 'near',
            priceLevel: rule.priceLevel,
            lastPrice,
            deadlineDate: null,
            note: rule.note,
          });
        }
      } else if (status === 'hit') {
        const alreadyNotified = await hasBeenNotifiedToday(rule.id, 'hit');
        if (!alreadyNotified) {
          events.push({
            id: rule.id,
            symbol: rule.symbol,
            ruleType: rule.ruleType,
            eventType: 'hit',
            priceLevel: rule.priceLevel,
            lastPrice,
            deadlineDate: null,
            note: rule.note,
          });
        }
      }
    }

    // Deadline rules (checked every refresh, but deduped per calendar day)
    if (rule.ruleType === 'deadline' && rule.deadlineDate) {
      const deadlineStatus = checkDeadline(rule.deadlineDate);
      if (deadlineStatus === 'tomorrow') {
        const alreadyNotified = await hasBeenNotifiedToday(rule.id, 'deadline-tomorrow');
        if (!alreadyNotified) {
          events.push({
            id: rule.id,
            symbol: rule.symbol,
            ruleType: rule.ruleType,
            eventType: 'deadline-tomorrow',
            priceLevel: null,
            lastPrice: marks.get(rule.symbol) ?? null,
            deadlineDate: rule.deadlineDate,
            note: rule.note,
          });
        }
      } else if (deadlineStatus === 'today') {
        const alreadyNotified = await hasBeenNotifiedToday(rule.id, 'deadline-today');
        if (!alreadyNotified) {
          events.push({
            id: rule.id,
            symbol: rule.symbol,
            ruleType: rule.ruleType,
            eventType: 'deadline-today',
            priceLevel: null,
            lastPrice: marks.get(rule.symbol) ?? null,
            deadlineDate: rule.deadlineDate,
            note: rule.note,
          });
        }
      }
    }
  }

  // Send notifications
  for (const event of events) {
    await sendPlanRuleNotification(event);
    await logNotification(event.id, event.eventType);
  }

  if (events.length > 0) {
    console.log(`[PlanRuleNotifications] Sent ${events.length} notifications`);
  }

  return { evaluated, notified: events.length };
}

/**
 * Load current marks for all symbols
 */
async function loadCurrentMarks(): Promise<Map<string, number>> {
  const res = await query<{ symbol: string; price: number }>(
    `SELECT symbol, price FROM marks`
  );
  return new Map(res.rows.map((r) => [r.symbol.toUpperCase(), Number(r.price)]));
}

/**
 * Send email notification for a plan rule event
 */
async function sendPlanRuleNotification(event: NotificationEvent): Promise<void> {
  const recipientEmail = process.env.ALERT_EMAIL_TO;
  if (!recipientEmail) {
    console.warn('[PlanRuleNotifications] ALERT_EMAIL_TO not configured, skipping email');
    return;
  }

  const { symbol, ruleType, eventType, priceLevel, lastPrice, deadlineDate, note } = event;

  let subject = '';
  let body = '';

  if (eventType === 'near') {
    subject = `📊 Plan Alert: ${symbol} ${ruleType} approaching ${priceLevel}`;
    body = `${symbol} is near your ${ruleType} level of $${priceLevel?.toFixed(2)}.\n\nLast Price: $${lastPrice?.toFixed(2)}\nDistance: ${((((lastPrice ?? 0) - (priceLevel ?? 0)) / (priceLevel ?? 1)) * 100).toFixed(2)}%`;
  } else if (eventType === 'hit') {
    subject = `🚨 Plan Alert: ${symbol} ${ruleType} HIT at ${priceLevel}`;
    body = `${symbol} has crossed your ${ruleType} level of $${priceLevel?.toFixed(2)}.\n\nLast Price: $${lastPrice?.toFixed(2)}`;
  } else if (eventType === 'deadline-tomorrow') {
    subject = `⏰ Plan Alert: ${symbol} deadline tomorrow`;
    body = `${symbol} deadline is tomorrow (${deadlineDate}).\n\nLast Price: $${lastPrice?.toFixed(2) ?? 'N/A'}`;
  } else if (eventType === 'deadline-today') {
    subject = `⏰ Plan Alert: ${symbol} deadline TODAY`;
    body = `${symbol} deadline is TODAY (${deadlineDate}).\n\nLast Price: $${lastPrice?.toFixed(2) ?? 'N/A'}`;
  }

  if (note) {
    body += `\n\nNote: ${note}`;
  }

  const htmlBody = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
    .alert-box { background: white; padding: 15px; margin: 15px 0; border-left: 4px solid #3b82f6; border-radius: 4px; }
    .label { font-weight: 600; color: #6b7280; }
    .value { font-size: 18px; font-weight: 700; color: #111827; }
    .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">${subject}</h1>
    </div>
    <div class="content">
      <div class="alert-box">
        <pre style="white-space: pre-wrap; font-family: inherit;">${body}</pre>
      </div>
      <div class="footer">
        <p>This alert was automatically triggered by Seek&Track Plan vs Price.</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  try {
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.ALERT_EMAIL_FROM || 'alerts@seek-track.com';

    if (resendApiKey) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [recipientEmail],
          subject,
          text: body,
          html: htmlBody,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Resend API failed: ${response.status} ${errorText}`);
      }

      const result = (await response.json()) as { id?: string };
      console.log('[PlanRuleNotifications] Email sent:', { id: result.id, to: recipientEmail });
    } else {
      console.log('[PlanRuleNotifications] Email notification (RESEND_API_KEY not configured):');
      console.log('Subject:', subject);
      console.log('Body:', body);
    }
  } catch (err) {
    console.error('[PlanRuleNotifications] Failed to send email:', err);
  }
}
