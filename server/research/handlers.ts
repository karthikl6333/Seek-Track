import type { Context } from 'hono';
import { discoverMapsForUniverse, revalidateYahooMaps } from './discovery.js';
import { getResearchDetail, getResearchSummary, refreshResearchQuotes } from './summary.js';
import { ensureResearchSeeded } from './universe.js';
import { addResearchUniverseSymbol, normalizeResearchSymbol, removeResearchUniverseSymbol, reorderResearchUniverse } from './universe-admin.js';
import { isCloudflareWorkers } from './yahoo.js';

export async function getResearchHandler(c: Context) {
  try {
    const data = await getResearchSummary();
    return c.json(data);
  } catch (err) {
    console.error('getResearchHandler error:', err);
    return c.json({ error: String(err) }, 500);
  }
}

export async function getResearchSymbolHandler(c: Context) {
  try {
    const symbol = c.req.param('symbol') || '';
    if (!symbol) return c.json({ error: 'symbol required' }, 400);
    const data = await getResearchDetail(symbol);
    if (!data) return c.json({ error: 'Unknown research symbol' }, 404);
    return c.json(data);
  } catch (err) {
    console.error('getResearchSymbolHandler error:', err);
    return c.json({ error: String(err) }, 500);
  }
}

export async function postResearchRefreshHandler(c: Context) {
  try {
    await ensureResearchSeeded();
    let remap = true;
    try {
      const body = await c.req.json().catch(() => ({}));
      if (body && body.remap === false) remap = false;
    } catch {
      // ignore
    }
    let discovered: string[] = [];
    if (remap) {
      const purged = await revalidateYahooMaps();
      discovered.push(...purged.deleted.map((d) => `deleted:${d}`));
      const d = await discoverMapsForUniverse();
      discovered.push(...d.discovered);
    }
    const quotes = await refreshResearchQuotes();
    const summary = await getResearchSummary();
    return c.json({ ...quotes, discovered, summary });
  } catch (err) {
    console.error('postResearchRefreshHandler error:', err);
    return c.json({ error: String(err) }, 500);
  }
}

export async function postResearchUniverseHandler(c: Context) {
  let body: { symbol?: string; name?: string; sectorNote?: string } = {};
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'JSON body required' }, 400);
  }
  const symbol = normalizeResearchSymbol(body.symbol);
  if (!symbol) {
    return c.json({ error: 'Invalid symbol: letters/digits only, 1–10 chars' }, 400);
  }
  try {
    const result = await addResearchUniverseSymbol({
      symbol,
      name: body.name,
      sectorNote: body.sectorNote,
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
}

export async function deleteResearchUniverseHandler(c: Context) {
  const symbol = normalizeResearchSymbol(c.req.param('symbol') || '');
  if (!symbol) {
    return c.json({ error: 'Invalid symbol: letters/digits only, 1–10 chars' }, 400);
  }
  try {
    const result = await removeResearchUniverseSymbol(symbol);
    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
}

export async function putResearchUniverseReorderHandler(c: Context) {
  let body: { symbols?: string[] } = {};
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'JSON body required' }, 400);
  }
  try {
    const result = await reorderResearchUniverse(body.symbols ?? []);
    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
}

export function startResearchRefreshCron(intervalMs = 15 * 60 * 1000): void {
  // DISABLE in Cloudflare Workers (scheduled cron + seeding cause "Too many subrequests" on free tier)
  if (isCloudflareWorkers()) {
    console.log('Research refresh cron disabled in Cloudflare Workers environment');
    return;
  }
  
  setTimeout(() => {
    void (async () => {
      await ensureResearchSeeded();
      await discoverMapsForUniverse().catch((e) =>
        console.error('research discovery failed:', e),
      );
      await refreshResearchQuotes().catch((e) =>
        console.error('research quote refresh failed:', e),
      );
    })();
  }, 8_000);

  setInterval(() => {
    void refreshResearchQuotes().catch((e) =>
      console.error('research quote refresh failed:', e),
    );
  }, intervalMs);

  console.log(`Research quote cron every ${Math.round(intervalMs / 60000)} minutes`);
}
