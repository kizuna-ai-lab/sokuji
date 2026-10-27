import { BACKEND_URL } from '../backend';

// One GET against the backend's JSON API. A lost session is the one error the
// screens act on by name; anything else carries its status.
export async function getJson<T>(path: string, o: { token?: string; fetch?: typeof fetch; label: string }): Promise<T> {
  const headers: Record<string, string> = {};
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  const res = await (o.fetch ?? fetch)(`${BACKEND_URL}${path}`, { method: 'GET', headers });
  if (res.status === 401) throw new Error('sign_in_required');
  if (!res.ok) throw new Error(`${o.label} ${res.status}`);
  return (await res.json()) as T;
}
