import type { Hono } from 'hono';

// Setup static file serving for Node.js (not used in Cloudflare Workers)
export async function setupStaticServing(app: Hono): Promise<void> {
  if (typeof process === 'undefined' || !process.versions?.node) {
    // Not Node.js - Cloudflare serves static files directly
    return;
  }
  
  try {
    // Dynamic imports for Node-only modules
    const { serveStatic } = await import('@hono/node-server/serve-static');
    const { existsSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    
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
  } catch (err) {
    console.error('Failed to setup static serving:', err);
    app.get('/', (c) => c.text('Seek&Track API - static assets not available'));
  }
}
