import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

/**
 * Simple HTTP Basic Authentication middleware for Cloudflare Workers/Pages.
 * Requires AUTH_PASSWORD (and optionally AUTH_USER) environment variables.
 * 
 * Unauthenticated requests return 401 with WWW-Authenticate header.
 * /api/health is excluded from auth checks (for monitoring).
 */
export function createAuthMiddleware() {
  return async (c: Context, next: Next) => {
    // Allow health checks without auth (for HostOps monitoring)
    if (c.req.path === '/api/health') {
      return next();
    }

    // Skip auth if not configured (dev mode)
    const authPassword = getEnvVar(c, 'AUTH_PASSWORD');
    if (!authPassword) {
      console.warn('AUTH_PASSWORD not set - authentication disabled');
      return next();
    }

    const authUser = getEnvVar(c, 'AUTH_USER') || 'admin';
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      throw new HTTPException(401, {
        message: 'Authentication required',
        res: new Response('Unauthorized', {
          status: 401,
          headers: {
            'WWW-Authenticate': 'Basic realm="Seek&Track", charset="UTF-8"',
          },
        }),
      });
    }

    // Decode Basic auth credentials
    const base64Credentials = authHeader.slice(6); // Remove "Basic "
    const credentials = atob(base64Credentials);
    const [username, password] = credentials.split(':');

    // Constant-time comparison to prevent timing attacks
    const validUser = constantTimeEqual(username, authUser);
    const validPassword = constantTimeEqual(password, authPassword);

    if (!validUser || !validPassword) {
      throw new HTTPException(401, {
        message: 'Invalid credentials',
        res: new Response('Unauthorized', {
          status: 401,
          headers: {
            'WWW-Authenticate': 'Basic realm="Seek&Track", charset="UTF-8"',
          },
        }),
      });
    }

    // Authentication successful
    await next();
  };
}

/**
 * Get environment variable from Hono context (works in both Node and Workers)
 */
function getEnvVar(c: Context, key: string): string | undefined {
  // Cloudflare Workers: env vars are in c.env
  if (c.env && typeof c.env === 'object' && key in c.env) {
    return String((c.env as Record<string, unknown>)[key]);
  }
  // Node.js: use process.env
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  }
  return undefined;
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
