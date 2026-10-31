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
 */
export const SCHEMA_VERSION = 3;

/** sha256 of server/schema-d1.sql (LF line endings) at SCHEMA_VERSION. */
export const SCHEMA_SHA256 = '4d9b2db200e959fce12f1b70a16b244dcfbf7de1defa3d22e50479e46ef73e5f';
