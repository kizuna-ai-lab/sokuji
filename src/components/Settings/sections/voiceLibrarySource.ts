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
import { synthesizeOnce } from '../../../services/clients/SonioxTtsRest';
import type { SonioxRegion } from '../../../lib/soniox/regions';
import { DEFAULT_SONIOX_REGION } from '../../../lib/soniox/regions';
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
  /** Synthesize one sample sentence in this voice. Rejects rather than
   *  returning null on failure; the section maps the error to a banner.
   *
   *  Optional — not every source can audition (see `canPreview`) — so a
   *  caller narrows on THIS member, not on `canPreview`: a plain boolean
   *  cannot narrow the type the way an optional method can, and `canPreview`
   *  exists precisely because some sources have no `preview` at all. */
  preview?(args: {
    id: string; language: string; text: string; speed: number; signal?: AbortSignal;
  }): Promise<{ audio: Float32Array; sampleRate: number }>;
  /** Namespace for the shared preview cache — distinct per voice project.
   *  Paired with `preview`: a source that can preview always sets this too. */
  readonly cacheNamespace?: string;
}

/** What BYOK preview needs beyond the voices-CRUD client: the TTS REST call
 *  itself (injectable so tests don't need a network fake, defaulting to the
 *  real `synthesizeOnce`) and the credential to synthesize with — the SAME
 *  project key/region `SonioxVoicesClient` above was constructed with, since
 *  a preview is just another call against that project. All optional so the
 *  parameter itself can default and existing callers keep compiling; a
 *  caller that wants a WORKING preview must supply the real apiKey/region. */
export interface ByokTtsDeps {
  synthesize?: typeof synthesizeOnce;
  apiKey?: string;
  region?: SonioxRegion;
}

/** What managed preview needs beyond the voices-CRUD client: the TTS REST
 *  call itself, injectable so tests don't need a network fake, defaulting to
 *  the real `synthesizeOnce`.
 *
 *  Unlike `ByokTtsDeps`, there is no `apiKey`/`region` here for a caller to
 *  forget — a managed preview holds no standing credential at all. Every
 *  preview mints its OWN single-use key via `client.sessionKey()` and uses it
 *  exactly once, so there is nothing about this dependency bag that could
 *  default to a silently broken credential the way `byokVoiceSource`'s
 *  `apiKey = ''` default once could. */
export interface ManagedTtsDeps {
  synthesize?: typeof synthesizeOnce;
}

/** BYOK: SonioxVoicesClient already satisfies the interface; this only names
 *  the fact and pins `canPreview`. `ttsDeps` carries what `preview` needs —
 *  see `ByokTtsDeps`. */
export function byokVoiceSource(client: SonioxVoicesClient, ttsDeps: ByokTtsDeps = {}): VoiceLibrarySource {
  const { synthesize = synthesizeOnce, apiKey = '', region = DEFAULT_SONIOX_REGION } = ttsDeps;
  return {
    list: () => client.list(),
    create: (name, clip, fileName) => client.create(name, clip, fileName),
    delete: (id) => client.delete(id),
    waitUntilReady: (id) => client.waitUntilReady(id),
    canPreview: true,
    preview: ({ id, language, text, speed, signal }) =>
      synthesize({ apiKey, region, voice: id, language, text, speed, signal }),
    // A different region is a different Soniox project — its cloned-voice
    // UUIDs are not the same namespace, so cached audio must not cross.
    cacheNamespace: `soniox:${region}`,
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
  } & ManagedTtsDeps = {}
): VoiceLibrarySource {
  const {
    pollDelayMs = managedVoicePollDelayMs,
    timeoutMs = 60_000,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    now = () => Date.now(),
    synthesize = synthesizeOnce,
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

    // Auditioning works for managed too: unlike BYOK there is no standing
    // Soniox key to synthesize with, but `preview` mints a single-use one of
    // its own per call (see below) rather than needing one held statically.
    canPreview: true,

    async preview({ id, language, text, speed, signal }) {
      // Mint FIRST and outside the try/finally: a mint that failed leased
      // nothing, so there is nothing to complete — and `preview-done`
      // resolves the account's OWN lease server-side, so a stray call here
      // could complete a DIFFERENT in-flight preview of this same account.
      const key = await client.sessionKey({ mode: 'voice_preview' });
      try {
        // `ttsApiKey`, not `sttApiKey`: this mode mints no transcription key
        // at all (backend design §5.6) — the field is absent by design, not
        // an oversight to fall back from.
        return await synthesize({
          apiKey: key.ttsApiKey, region: key.region,
          voice: id, language, text, speed, signal,
        });
      } finally {
        // `finally`, not the success path. This call is the BILLING
        // TRIGGER: it writes the lease's `started_at`, which is what lets
        // the reconciler's sweep find the lease at all, and what releases
        // the account's exclusivity lease instead of leaving it to the ~45s
        // backstop. A user cancelling mid-synthesis is the common case, not
        // the rare one — which is exactly why this must not live on the
        // success path alone.
        //
        // Never rethrows: a failed completion must not mask the synthesis
        // result, nor replace a useful error with a bookkeeping one. The
        // charge is not lost either way — it is only deferred to the next
        // sweep triggered by unrelated traffic in this region.
        await client.previewDone().catch(() => {});
      }
    },

    // A different region is a different Soniox project — same reasoning as
    // byokVoiceSource's own namespace, just read off the client's region
    // (set once, at construction, from the account's Soniox region setting)
    // rather than a ttsDeps field of its own.
    cacheNamespace: `managed:${client.region}`,
  };
}
