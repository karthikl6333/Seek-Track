/**
 * The private-prefix gate used by the Cloudflare worker (scripts/prepare-cf-pages.js embeds this very
 * function with `.toString()` into _worker.js, so the code that is tested here is the code that ships).
 *
 * true for "/_private" and everything under it, however the path is spelled: percent-encoded (also
 * double-encoded), mixed case, doubled or backslash separators. A malformed percent-encoding counts as
 * private. Such requests never reach env.ASSETS; they go to the Hono app (auth first, then a 404 route).
 * Must be self-contained: no references to anything outside the function body.
 */
export function isPrivatePath(pathname) {
  let p = pathname;
  for (let i = 0; i < 4; i++) {
    let d;
    try {
      d = decodeURIComponent(p);
    } catch {
      return true;
    }
    if (d === p) break;
    p = d;
  }
  p = p.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
  return p === '/_private' || p.startsWith('/_private/');
}
