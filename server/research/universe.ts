import { query } from '../db.js';
import { fetchYahooMeta } from '../quotes/quotes.js';
import { RESEARCH_SEED_MAPS, RESEARCH_UNIVERSE } from './seeds.js';
import type { EtfMapRow, UniverseRow } from './types.js';
import { isCloudflareWorkers } from './yahoo.js';

export async function listUniverse(): Promise<UniverseRow[]> {
  const res = await query<{
    symbol: string;
    name: string;
    sort_order: number;
    sector_note: string;
  }>(`SELECT * FROM research_universe ORDER BY sort_order ASC, symbol ASC`);
  return res.rows.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    sortOrder: Number(r.sort_order),
    sectorNote: r.sector_note,
  }));
}

export async function listMaps(underlying?: string): Promise<EtfMapRow[]> {
  const res = underlying
    ? await query<{
        underlying: string;
        etf: string;
        direction: string;
        factor: number;
        source: string;
        updated_at: Date | string | null;
      }>(
        `SELECT * FROM research_etf_map WHERE underlying = $1 ORDER BY direction, abs(factor) DESC, etf`,
        [underlying.toUpperCase()],
      )
    : await query<{
        underlying: string;
        etf: string;
        direction: string;
        factor: number;
        source: string;
        updated_at: Date | string | null;
      }>(`SELECT * FROM research_etf_map ORDER BY underlying, direction, abs(factor) DESC, etf`);

  return res.rows.map((r) => ({
    underlying: r.underlying,
    etf: r.etf,
    direction: r.direction as 'bull' | 'bear',
    factor: Number(r.factor),
    source: r.source,
    updatedAt:
      r.updated_at === null
        ? new Date().toISOString()
        : typeof r.updated_at === 'string'
          ? r.updated_at
          : r.updated_at.toISOString(),
  }));
}

async function getResearchUniverseSeededFlag(): Promise<boolean> {
  const res = await query<{ data: string | null }>(
    `SELECT data FROM settings WHERE id = 1`,
  );
  const dataStr = res.rows[0]?.data;
  let data: unknown;
  try {
    data = dataStr ? JSON.parse(dataStr) : null;
  } catch {
    data = null;
  }
  return Boolean(data && typeof data === 'object' && (data as any).researchUniverseSeeded === true);
}

export async function setResearchUniverseSeededFlag(): Promise<void> {
  await query(
    `INSERT INTO settings (id, data) VALUES (1, '{"researchUniverseSeeded":true}')
     ON CONFLICT (id) DO UPDATE SET
       data = json_set(COALESCE(settings.data, '{}'), '$.researchUniverseSeeded', json('true'))`,
  );
}

/** Per isolate: once the universe is confirmed seeded, skip the COUNT + settings check. */
let researchSeedVerified = false;

export async function ensureResearchSeeded(): Promise<void> {
  if (researchSeedVerified) return;
  const countRes = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM research_universe`,
  );
  const count = Number(countRes.rows[0]?.n ?? 0);
  const alreadySeeded = await getResearchUniverseSeededFlag();

  // CRITICAL: Early return when data already seeded (skip expensive DELETE + INSERT loops on every GET)
  if (count > 0 && alreadySeeded) {
    researchSeedVerified = true;
    return;
  }

  // DISABLE expensive seeding on Cloudflare Workers (causes "Too many subrequests" on free tier)
  // Workers should rely on data already seeded via Node.js local boot or manual admin tool
  if (isCloudflareWorkers()) {
    console.log('ensureResearchSeeded: skipping seed on Cloudflare Workers');
    return;
  }

  if (count > 0 && !alreadySeeded) {
    await setResearchUniverseSeededFlag();
  } else if (!alreadySeeded && count === 0) {
    const excludedRes = await query<{ symbol: string }>(
      `SELECT symbol FROM research_universe_excluded`,
    );
    const excluded = new Set(excludedRes.rows.map((r) => r.symbol.toUpperCase()));
    for (const u of RESEARCH_UNIVERSE) {
      if (excluded.has(u.symbol.toUpperCase())) continue;
      await query(
        `INSERT INTO research_universe (symbol, name, sort_order, sector_note)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (symbol) DO NOTHING`,
        [u.symbol, u.name, u.sortOrder, u.sectorNote],
      );
    }
    await setResearchUniverseSeededFlag();
  }
  // NEVER seed when alreadySeeded is true (even if table empty)

  // Safety scrub: keep excluded symbols out of universe + maps
  await query(
    `DELETE FROM research_etf_map
     WHERE underlying IN (SELECT symbol FROM research_universe_excluded)`,
  );
  // Drop Yahoo currency/composite junk (MVLL-USD, SNXX.SW, etc.)
  await query(
    `DELETE FROM research_etf_map WHERE etf LIKE '%-%' OR etf LIKE '%.%'`,
  );
  await query(
    `DELETE FROM research_universe
     WHERE symbol IN (SELECT symbol FROM research_universe_excluded)`,
  );

  const present = new Set((await listUniverse()).map((u) => u.symbol));

  for (const m of RESEARCH_SEED_MAPS) {
    if (!present.has(m.underlying)) continue;
    await query(
      `INSERT INTO research_etf_map (underlying, etf, direction, factor, source, updated_at)
       VALUES ($1, $2, $3, $4, 'seed', NOW())
       ON CONFLICT (underlying, etf) DO UPDATE SET
         direction = EXCLUDED.direction,
         factor = EXCLUDED.factor,
         source = CASE
           WHEN research_etf_map.source = 'override' THEN research_etf_map.source
           ELSE EXCLUDED.source
         END,
         updated_at = NOW()`,
      [m.underlying, m.etf, m.direction, m.factor],
    );

    // Keep pair_cache in sync for CrossCheck / pair resolver
    await query(
      `INSERT INTO pair_cache (etf, underlying, factor, theme, source, raw_name, resolved_at)
       VALUES ($1, $2, $3, $4, 'seed', NULL, NOW())
       ON CONFLICT (etf) DO NOTHING`,
      [m.etf, m.underlying, m.factor, `${m.underlying} family`],
    );
  }
}
