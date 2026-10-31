/**
 * Minimal fetch helpers for the Research and Watchlist views. Unlike `api()` in client.ts these use a
 * relative base by default, send no Content-Type on GET, and surface the server's `{ error }` message.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
  }
  return res.json() as Promise<T>;
}

export async function apiSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j?.error) msg = j.error;
      else if (text) msg += `: ${text}`;
    } catch {
      if (text) msg += `: ${text}`;
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}
