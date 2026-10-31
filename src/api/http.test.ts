import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiSend } from './http';

function mockFetch(res: Partial<Response> & { text?: () => Promise<string> }) {
  const f = vi.fn().mockResolvedValue(res);
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe('api/http', () => {
  it('apiGet returns parsed JSON', async () => {
    mockFetch({ ok: true, json: async () => ({ a: 1 }) });
    expect(await apiGet<{ a: number }>('/api/x')).toEqual({ a: 1 });
  });

  it('apiGet error includes status and body text', async () => {
    mockFetch({ ok: false, status: 500, statusText: 'Boom', text: async () => 'oops' });
    await expect(apiGet('/api/x')).rejects.toThrow('500 Boom: oops');
  });

  it('apiSend sends JSON body with content-type', async () => {
    const f = mockFetch({ ok: true, json: async () => ({ ok: true }) });
    await apiSend('/api/x', 'POST', { s: 'A' });
    expect(f).toHaveBeenCalledWith('/api/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"s":"A"}',
    });
  });

  it('apiSend with no body sends no headers/body', async () => {
    const f = mockFetch({ ok: true, json: async () => ({}) });
    await apiSend('/api/x', 'DELETE');
    expect(f).toHaveBeenCalledWith('/api/x', { method: 'DELETE', headers: undefined, body: undefined });
  });

  it("apiSend prefers the server's { error } message", async () => {
    mockFetch({ ok: false, status: 400, statusText: 'Bad', text: async () => '{"error":"Nope"}' });
    await expect(apiSend('/api/x', 'POST', {})).rejects.toThrow('Nope');
  });

  it('apiSend falls back to status + text for non-JSON errors', async () => {
    mockFetch({ ok: false, status: 502, statusText: 'Bad Gateway', text: async () => 'upstream' });
    await expect(apiSend('/api/x', 'POST', {})).rejects.toThrow('502 Bad Gateway: upstream');
  });
});
