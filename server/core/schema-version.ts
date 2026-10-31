/**
 * D1 schema version. ensureSchema re-runs the idempotent schema (CREATE ... IF NOT EXISTS + seeds)
 * once per DB whenever the stored schema_meta.version differs from this.
 *
 * RULE: any change to server/schema-d1.sql must bump SCHEMA_VERSION and update SCHEMA_SHA256
 * (CI fails otherwise: server/schema-version.test.ts). Forgetting the bump means existing DBs never
 * get the change (prod incident: #87 added plan_rules but stayed at v2 → "no such table").
 *
 * v1: initial D1 schema
 * v2: read-budget indexes (marks.updated_at, price_alerts(status, symbol), pair_cache.underlying)
 * v3: plan_rules + plan_rule_notifications (+ seeded plan rules)
 * v4: watchlist_quotes.short_name (company name for the Overview watchlist) plus fundamentals columns
 *     shares_outstanding, cap_price, fundamentals_updated_at (market cap, refreshed <= once/24h); added to
 *     existing DBs by ensureColumn in db-d1.ts
 */
export const SCHEMA_VERSION = 4;

/** sha256 of server/schema-d1.sql (LF line endings) at SCHEMA_VERSION. */
export const SCHEMA_SHA256 = 'a2b569bd726cfda2238575e2a1659804aa9cfdd9c8e239e1e7f338336fe626ab';
