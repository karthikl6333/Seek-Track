import type { Hono } from 'hono';
import {
  getAlertsHandler,
  postAlertsHandler,
  deleteAlertHandler,
  postEvaluateAlertsHandler,
} from '../quotes/alerts.js';
import {
  getPlanRulesHandler,
  postPlanRulesHandler,
  patchPlanRuleHandler,
  deletePlanRuleHandler,
} from '../plan/plan-rules.js';

/** Routes: price alerts and plan rules. */
export function registerPlanRoutes(app: Hono): void {
  app.get('/api/alerts', getAlertsHandler);
  app.post('/api/alerts', postAlertsHandler);
  app.delete('/api/alerts/:id', deleteAlertHandler);
  app.post('/api/alerts/evaluate', postEvaluateAlertsHandler);

  app.get('/api/plan-rules', getPlanRulesHandler);
  app.post('/api/plan-rules', postPlanRulesHandler);
  app.patch('/api/plan-rules/:id', patchPlanRuleHandler);
  app.delete('/api/plan-rules/:id', deletePlanRuleHandler);
}
