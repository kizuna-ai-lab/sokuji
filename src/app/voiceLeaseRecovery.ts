/**
 * A voice-only lease the app took and never ended (it crashed, or was killed, before `session-end` went out) keeps
 * the account held. At launch, once the sign-in is there, the lease remembered from before is ended and forgotten.
 * What was remembered is read once, when the page attaches: a lease taken later in this launch is never the one
 * ended here. The request names the lease, and a service that grants voice-only leases ends only the lease a
 * `session-end` names: one that arrives after a newer session has started changes nothing of that session, so this
 * need not wait for, or be cancelled by, a start.
 */
import { reportWarning } from '../lib/diagnostics/report';
import type { AuthContext } from '../lib/run/types';
import { endRememberedVoiceLease, voiceLeaseMemory, type StoredVoiceLeases } from '../providers/soniox/voiceLeaseMemory';

export function watchVoiceLeaseRecovery(o: {
  auth(): AuthContext;
  watchSignIn(fn: () => void): () => void;
  /** The API root this build talks to. */
  apiUrl(): string;
  memory?: StoredVoiceLeases;
  fetch?: typeof fetch;
  warn?: typeof reportWarning;
}): () => void {
  const memory = o.memory ?? voiceLeaseMemory;
  const warn = o.warn ?? reportWarning;
  const remembered = memory.read();
  /** Once per launch: a lease kept after a failure waits for the next one. */
  let done = false;
  let trying = false;
  const check = () => {
    const a = o.auth();
    if (done || trying || !a.signedIn || a.loaded === false) return;
    trying = true;
    void (async () => {
      const lease = await remembered;
      // Nothing to end; or a lease asked of another service than this build's, which gets no token of this one.
      if (lease === null || lease.apiUrl !== o.apiUrl()) {
        done = true;
        return;
      }
      let token: string | null = null;
      try {
        token = await o.auth().getToken();
      } catch {
        // No token now: the next change of the sign-in asks again.
      }
      if (!token) return;
      done = true;
      const outcome = await endRememberedVoiceLease({ lease, getToken: async () => token, ...(o.fetch ? { fetch: o.fetch } : {}) });
      if (outcome === 'ended') memory.forget(lease.leaseId);
      else warn('SonioxLease', 'Could not end a voice session left open by a previous launch; the next launch tries again.', { dedupeKey: 'soniox:voice-lease-recovery' });
    })().finally(() => { trying = false; });
  };
  const off = o.watchSignIn(check);
  check();
  return off;
}
