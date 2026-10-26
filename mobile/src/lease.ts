import type { SonioxRegion } from '@shared/lib/soniox/regions';
import { BACKEND_URL } from './backend';

export interface Grant {
  leaseId: string;
  clientReferenceId: string;
  region: SonioxRegion;
  maxSessionDurationSeconds: number;
  streams: Array<{ role: string; apiKey: string; clientReferenceId: string }>;
}

// The desktop's DEFAULT_CONFLICT_RETRY_MS and CONFLICT_WAIT_LIMIT_MS: after a drop
// the old lease is still held, so session-key answers 409 for up to a minute.
const CONFLICT_RETRY_MS = 3000;
const CONFLICT_WAIT_LIMIT_MS = 60000;

const headers = (token: string) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
});

function parseGrant(body: unknown): Grant {
  const g = body as Partial<Grant> | null;
  if (
    !g ||
    typeof g.leaseId !== 'string' || !g.leaseId ||
    typeof g.clientReferenceId !== 'string' || !g.clientReferenceId ||
    typeof g.region !== 'string' ||
    typeof g.maxSessionDurationSeconds !== 'number' ||
    !Array.isArray(g.streams) || g.streams.length === 0
  ) {
    throw new Error('bad_grant');
  }
  return g as Grant;
}

export async function leaseKey(o: {
  token: string;
  region: SonioxRegion;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<Grant> {
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const start = now();
  for (;;) {
    const res = await doFetch(`${BACKEND_URL}/api/soniox/session-key`, {
      method: 'POST',
      headers: headers(o.token),
      body: JSON.stringify({ mode: 'participant', textOnly: true, bothSplit: false, region: o.region }),
    });
    if (res.status === 200) return parseGrant(await res.json());
    if (res.status === 401) throw new Error('sign_in_required');
    if (res.status === 402) throw new Error('balance_exhausted');
    if (res.status === 409) {
      await sleep(CONFLICT_RETRY_MS);
      if (now() - start < CONFLICT_WAIT_LIMIT_MS) continue;
      throw new Error('lease_conflict');
    }
    throw new Error(`session-key ${res.status}`);
  }
}

export async function sessionStarted(o: {
  token: string;
  leaseId: string;
  role: string;
  fetch?: typeof fetch;
}): Promise<void> {
  const res = await (o.fetch ?? fetch)(`${BACKEND_URL}/api/soniox/session-started`, {
    method: 'POST',
    headers: headers(o.token),
    body: JSON.stringify({ leaseId: o.leaseId, role: o.role }),
  });
  if (!res.ok) throw new Error(`session-started ${res.status}`);
}

// The backend ends the account's session, not the lease: a late session-end for an
// old lease would end the new one. Callers send it before leasing again, never after.
// Budget and attempts follow the desktop (4 s, three attempts at most).
const END_BUDGET_MS = 4000;
const END_RETRY_WAITS_MS = [500, 1000];

export async function sessionEnd(o: {
  token: string;
  leaseId: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<boolean> {
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const deadline = now() + END_BUDGET_MS;
  for (let attempt = 0; attempt <= END_RETRY_WAITS_MS.length; attempt++) {
    const left = deadline - now();
    if (left <= 0) break;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), left);
    try {
      const res = await doFetch(`${BACKEND_URL}/api/soniox/session-end`, {
        method: 'POST',
        headers: headers(o.token),
        body: JSON.stringify({ leaseId: o.leaseId }),
        signal: abort.signal,
      });
      if (res.ok) return true;
      console.log(`session-end ${res.status}`);
      if (res.status < 500) return false;
    } catch (err) {
      console.log(`session-end failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
    const wait = END_RETRY_WAITS_MS[attempt];
    if (wait === undefined || now() + wait >= deadline) break;
    await sleep(wait);
  }
  return false;
}
