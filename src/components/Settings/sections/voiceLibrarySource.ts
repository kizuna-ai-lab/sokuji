/**
 * The seam SonioxVoiceSection sits on.
 *
 * The section used to construct a SonioxVoicesClient from `settings.apiKey`
 * and short-circuit it to null for managed accounts, which is why the managed
 * twin could only ever show built-in voices. Lifting that construction out
 * turns "where do voices come from" into a parameter: BYOK talks to Soniox
 * directly with the user's project key, managed talks to our backend with a
 * session token, and the section itself stops knowing the difference.
 *
 * `canPreview` is part of the contract because auditioning a voice means
 * synthesizing a sample, which needs a Soniox key the managed user does not
 * have. That is a property of the SOURCE, not of the section.
 */
import type { SonioxVoice, SonioxVoicesClient } from '../../../services/clients/SonioxVoicesClient';
import type { ManagedVoicesClient, ManagedVoice } from '../../../services/clients/ManagedVoicesClient';
import { SonioxVoicesError } from '../../../services/clients/SonioxVoicesClient';
import { saveVoiceClip, clearVoiceClip } from '../../../lib/soniox/voiceClipStorage';
import { SONIOX_TTS_MODEL } from '../../../lib/soniox/ttsCatalog';
import { managedVoicePollDelayMs } from '../../../services/clients/managedVoicePolling';

export interface VoiceLibrarySource {
  /** Every voice this source can offer. The managed source returns zero or
   *  one, so the section's list rendering is unchanged either way. */
  list(): Promise<SonioxVoice[]>;
  create(name: string, clip: Blob, fileName?: string): Promise<SonioxVoice>;
  delete(id: string): Promise<void>;
  waitUntilReady(id: string): Promise<SonioxVoice>;
  /** False when auditioning is impossible because this source has no Soniox
   *  key to synthesize a sample with. */
  readonly canPreview: boolean;
}

/** BYOK: SonioxVoicesClient already satisfies the interface; this only names
 *  the fact and pins `canPreview`. */
export function byokVoiceSource(client: SonioxVoicesClient): VoiceLibrarySource {
  return {
    list: () => client.list(),
    create: (name, clip, fileName) => client.create(name, clip, fileName),
    delete: (id) => client.delete(id),
    waitUntilReady: (id) => client.waitUntilReady(id),
    canPreview: true,
  };
}

const TTS_MODEL = SONIOX_TTS_MODEL;

/** Project the backend's flat voice record into the per-model shape the
 *  section reads readiness from. Without this the section's isReady/isFailed
 *  helpers find no matching model entry and every managed voice renders as
 *  "processing…" forever. */
function toSonioxVoice(voice: ManagedVoice): SonioxVoice {
  return {
    id: voice.voiceId,
    // The backend's real name is an internal identifier (`u_<account>_<token>`)
    // that must never be shown; SonioxVoiceSection supplies the label.
    name: '',
    created_at: new Date(voice.createdAt).toISOString(),
    models: [{ model: TTS_MODEL, status: voice.status }],
  };
}

/**
 * Managed (Kizuna AI): the account's single cached voice, via our backend.
 *
 * Two things differ from BYOK in ways the section must not have to know:
 *
 *  - The clip is saved to this device BEFORE the build request goes out. The
 *    backend keeps no copy, so the clip is the only thing that can rebuild an
 *    evicted voice — and saving it only on success would lose it exactly when
 *    a retry needs it most.
 *  - `name` is ignored. The backend names voices itself, uniquely per build,
 *    because Soniox enforces name uniqueness per project.
 *
 * `accountId` is the Better Auth user id this source belongs to. It is what
 * the stored clip is filed under, so a recording made here can never be read
 * back — and re-uploaded — under a different account signed in on the same
 * device. The caller already mints a fresh source per account (see
 * ProviderSpecificSettings' `sonioxVoiceSource` memo), so passing it in keeps
 * "which account is this" a property of the source rather than something the
 * storage layer has to re-derive at call time.
 */
export function managedVoiceSource(
  client: ManagedVoicesClient,
  accountId: string,
  opts: {
    /** Wait before readiness poll number `attempt` (0-based). Defaults to the
     *  schedule shared with session-start preparation. */
    pollDelayMs?: (attempt: number) => number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {}
): VoiceLibrarySource {
  const {
    pollDelayMs = managedVoicePollDelayMs,
    timeoutMs = 60_000,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    now = () => Date.now(),
  } = opts;
  return {
    async list() {
      const voice = await client.mine();
      return voice ? [toSonioxVoice(voice)] : [];
    },

    async create(_name, clip) {
      await saveVoiceClip(accountId, clip);
      // pin: false — building a voice from the settings panel is not starting
      // a session, and a pin taken here would hold one of the pool's scarce
      // slots against eviction for no session's benefit.
      const created = await client.ensure({ pin: false, clip });
      return toSonioxVoice({ voiceId: created.voiceId, status: created.status, createdAt: Date.now() });
    },

    async delete(_id) {
      // The backend deletes THE account's voice; there is only one, so the id
      // is informational. Order matters: clearing the clip first would lose
      // the recording even when the backend refuses (voice_pinned).
      await client.remove();
      try {
        await clearVoiceClip();
      } catch (error) {
        // The voice IS gone (at Soniox and from our table) — only the local
        // recording survived. Resolving here would tell the user their
        // biometric material was removed from this device when it was not,
        // so this rejects with a slug of its own: the section maps it to
        // copy that says exactly which half failed, rather than to the
        // generic "delete failed" that would be a second lie.
        throw new SonioxVoicesError(
          'clip_clear_failed',
          error instanceof Error ? error.message : String(error),
          0
        );
      }
    },

    // `_id` unused: this account has at most one voice, so `client.mine()`
    // already names it unambiguously — there is nothing to disambiguate by id.
    async waitUntilReady(_id) {
      const deadline = now() + timeoutMs;
      let attempt = 0;
      for (;;) {
        // Wait FIRST: `create` has just reported `processing`, so a poll
        // right now would only repeat that answer — at the price of one
        // Soniox getVoice. The wait is clamped to what is left of the budget
        // and the deadline is re-checked after it, so no poll begins past the
        // ceiling (the same rule session-start preparation follows: that
        // poll carries its own request timeout and would otherwise hold the
        // panel well past the budget it was just told was spent).
        const remaining = deadline - now();
        if (remaining <= 0) {
          throw new SonioxVoicesError('timeout', 'Voice processing timed out', 408);
        }
        await sleep(Math.min(pollDelayMs(attempt++), remaining));
        if (now() >= deadline) {
          throw new SonioxVoicesError('timeout', 'Voice processing timed out', 408);
        }
        const voice = await client.mine();
        if (!voice) {
          // Another device superseded this build, or the LRU evicted the row.
          // There is nothing left to wait for, and the section's voice_failed
          // branch already says "try again".
          throw new SonioxVoicesError('voice_failed', 'The voice is no longer available', 404);
        }
        if (voice.status === 'ready') return toSonioxVoice(voice);
        if (voice.status === 'failed') {
          throw new SonioxVoicesError('voice_failed', 'Voice processing failed', 503);
        }
      }
    },

    // Auditioning synthesizes a sample, which needs a Soniox key a managed
    // user does not have.
    canPreview: false,
  };
}
