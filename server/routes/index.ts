import type { Hono } from 'hono';
import { registerMiddleware } from './middleware.js';
import { registerSystemRoutes } from './system.js';
import { registerPortfolioRoutes } from './portfolio.js';
import { registerQuotesRoutes } from './quotes.js';
import { registerResearchRoutes } from './research.js';
import { registerPaperRoutes } from './paper.js';
import { registerPlanRoutes } from './plan.js';
import { registerNewsRoutes } from './news.js';
import { registerIdeasRoutes } from './ideas.js';

/** Registers middleware, then every API route group, on `app`. */
export function registerApi(app: Hono): void {
  registerMiddleware(app);
  registerSystemRoutes(app);
  registerPortfolioRoutes(app);
  registerQuotesRoutes(app);
  registerResearchRoutes(app);
  registerPaperRoutes(app);
  registerPlanRoutes(app);
  registerNewsRoutes(app);
  registerIdeasRoutes(app);
}
