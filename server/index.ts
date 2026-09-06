import { serve as startServer } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSchema, query } from './db.js';
import { deleteJournal, listJournal, postJournal } from './journal.js';
import { getMarks, putMarks } from './marks.js';
import { getSettings, putSettings } from './settings.js';
import {
  importCsvHandler,
  listTrades,
  patchTrade,
  postTrades,
} from './trades.js';

const app = new Hono();

app.use(
  '/api/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

app.get('/api/health', async (c) => {
  try {
    await query('SELECT 1');
    return c.json({ ok: true });
  } catch (err) {
    console.error('health check failed:', err);
    return c.json({ ok: false, error: 'database unavailable' }, 503);
  }
});

app.get('/api/trades', listTrades);
app.post('/api/trades', postTrades);
app.patch('/api/trades/:id', patchTrade);
app.post('/api/import', importCsvHandler);

app.get('/api/marks', getMarks);
app.put('/api/marks', putMarks);

app.get('/api/journal', listJournal);
app.post('/api/journal', postJournal);
app.delete('/api/journal', deleteJournal);
app.delete('/api/journal/:id', deleteJournal);

app.get('/api/settings', getSettings);
app.put('/api/settings', putSettings);

const here = dirname(fileURLToPath(import.meta.url));
const distCandidates = [
  join(process.cwd(), 'dist'),
  join(here, '..', 'dist'),
  join(here, 'dist'),
];
const distRoot = distCandidates.find((p) => existsSync(join(p, 'index.html')));

if (distRoot) {
  let relativeRoot = distRoot;
  const cwd = process.cwd();
  if (distRoot.startsWith(cwd)) {
    relativeRoot = distRoot.slice(cwd.length).replace(/^[/\\]/, '') || '.';
  }
  app.use('/*', serveStatic({ root: relativeRoot }));
  app.get('*', serveStatic({ root: relativeRoot, path: 'index.html' }));
} else {
  app.get('/', (c) => c.text('Seek&Track API - build client first'));
}

const port = Number(process.env.PORT || 3000);

async function main() {
  await ensureSchema();
  console.log('Seek&Track listening on :' + String(port));
  startServer({ fetch: app.fetch, port });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exitCode = 1;
});
