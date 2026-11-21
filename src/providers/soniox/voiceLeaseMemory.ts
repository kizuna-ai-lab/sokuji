/**
 * Where the app remembers the voice-only lease it holds (`lease.ts`,
 * `VoiceLeaseMemory`), and how a launch ends one a previous launch left
 * behind. The account stays held by such a lease until `session-end`
 * reaches the backend, so an app that died before sending it sends it when
 * it next starts (`app/voiceLeaseRecovery.ts`). What is kept is the lease's
 * id and the API root it was asked of, in the settings storage: no key, no
 * token, nothing about the account.
 */
import { ServiceFactory } from '../../services/ServiceFactory';
import type { RememberedVoiceLease, VoiceLeaseMemory } from './lease';

/** The settings key the lease is kept under. Device-local in the extension (`SettingsService`): a lease belongs to the device that took it. */
export const VOICE_LEASE_KEY = 'soniox.voiceOnlyLease';

/** One stored value: the settings service's key in the app, a variable in tests. */
export interface VoiceLeaseStorage {
  read(): Promise<unknown>;
  write(value: RememberedVoiceLease | null): Promise<unknown>;
}

/** The memory the lease writes, and what a launch reads of it. */
export interface StoredVoiceLeases extends VoiceLeaseMemory {
  /** The lease remembered, or null: nothing stored, or something that is not a lease. */
  read(): Promise<RememberedVoiceLease | null>;
}

const settingsStorage: VoiceLeaseStorage = {
  read: () => ServiceFactory.getSettingsService().getSetting<unknown>(VOICE_LEASE_KEY, null),
  write: (value) => ServiceFactory.getSettingsService().setSetting(VOICE_LEASE_KEY, value),
};

function asLease(stored: unknown): RememberedVoiceLease | null {
  const v = stored as { leaseId?: unknown; apiUrl?: unknown } | null;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return typeof v.leaseId === 'string' && v.leaseId !== '' && typeof v.apiUrl === 'string' && v.apiUrl !== '' ? { leaseId: v.leaseId, apiUrl: v.apiUrl } : null;
}

/**
 * A memory of one lease: an account holds one at a time. A write that fails is not the session's to hear: the
 * lease then ends at the backend without this app's help, later.
 */
export function createVoiceLeaseMemory(storage: VoiceLeaseStorage = settingsStorage): StoredVoiceLeases {
  /** The lease this launch remembered last; null once it forgot one; undefined while it has written nothing. */
  let latest: string | null | undefined;
  const write = (value: RememberedVoiceLease | null): void => {
    void (async () => storage.write(value))().catch(() => {});
  };
  return {
    remember(lease) {
      latest = lease.leaseId;
      write({ leaseId: lease.leaseId, apiUrl: lease.apiUrl });
    },
    forget(leaseId) {
      // A lease remembered since is not this one: it stays.
      if (latest !== undefined && latest !== leaseId) return;
      latest = null;
      write(null);
    },
    async read() {
      try {
        return asLease(await storage.read());
      } catch {
        return null;
      }
    },
  };
}

/** The app's own memory, in its settings storage. */
export const voiceLeaseMemory: StoredVoiceLeases = createVoiceLeaseMemory();

/** The bound of the one request a launch sends: a request that never answers must not hold the recovery for the whole launch. */
export const VOICE_LEASE_END_TIMEOUT_MS = 10_000;

/** Statuses that are not the backend's word on the lease: the sign-in was not accepted, or the request was not served. */
const NOT_AN_ANSWER = new Set([401, 408, 429]);

/**
 * Sends `session-end` for a remembered lease, to the API root it was asked of, with a fresh token. `ended`: the
 * backend answered about the lease, a refusal included, so nothing is left to end. `kept`: no token, a request
 * that did not arrive or was not answered in time, a sign-in that was not accepted, a request turned away
 * unserved, or a 5xx; the next launch tries again.
 */
export async function endRememberedVoiceLease(o: {
  lease: RememberedVoiceLease;
  getToken(): Promise<string | null>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<'ended' | 'kept'> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), o.timeoutMs ?? VOICE_LEASE_END_TIMEOUT_MS);
  try {
    const token = await o.getToken();
    if (!token) return 'kept';
    const res = await (o.fetch ?? fetch)(`${o.lease.apiUrl}/soniox/session-end`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ leaseId: o.lease.leaseId }),
      signal: abort.signal,
    });
    return res.status >= 500 || NOT_AN_ANSWER.has(res.status) ? 'kept' : 'ended';
  } catch {
    return 'kept';
  } finally {
    clearTimeout(timer);
  }
}
