import { BACKEND_URL } from '../backend';

// React Native's fetch has no timeout of its own. These are foreground
// screens, so a JS timer is the right cut-off (the session's waits are not).
export const REQUEST_TIMEOUT_MS = 15000;

// One GET against the backend's JSON API. A lost session is the one error the
// screens act on by name; anything else carries its status, a stall its label.
export async function getJson<T>(path: string, o: { token?: string; fetch?: typeof fetch; label: string; timeoutMs?: number }): Promise<T> {
  const headers: Record<string, string> = {};
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), o.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await (o.fetch ?? fetch)(`${BACKEND_URL}${path}`, { method: 'GET', headers, signal: abort.signal });
    if (res.status === 401) throw new Error('sign_in_required');
    if (!res.ok) throw new Error(`${o.label} ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    if (abort.signal.aborted) throw new Error(`${o.label} timeout`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
