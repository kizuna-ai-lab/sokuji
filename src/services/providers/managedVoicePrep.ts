/**
 * Make the account's managed custom voice usable, right before a session
 * starts.
 *
 * The backend runs Soniox's voice quota as an LRU cache, so a voice the user
 * selected days ago may have been evicted since. This routine claims the slot
 * (pinning it against eviction for the start window), rebuilds from this
 * device's stored clip if the cache entry is gone, and waits for the build.
 *
 * It NEVER throws. Every failure resolves to a reason, because the session is
 * still perfectly startable with a built-in voice — losing spoken output in
 * the user's own voice is a degradation, not a reason to refuse to translate.
 * The caller falls back for that session only and explains why afterwards; the
 * stored preference is left alone so the next session tries again.
 *
 * Deliberately outside MainPanel: `connectConversation` is a ~560-line
 * useCallback, and this routine has six branches worth testing. Deliberately
 * NOT inside `computeStartGate` either — that function is pure and is
 * evaluated by the subtitle window too, so an uploading ten-second side effect
 * there would break the property that lets both surfaces agree.
 */
// Moved beside its caller (KizunaAISonioxProviderConfig.prepareToStart, S5); deliberately React-, store- and i18n-free — a descriptor calls it without cycles.
import type { ManagedVoicesClient } from '../../services/clients/ManagedVoicesClient';
import { SonioxVoicesError } from '../../services/clients/SonioxVoicesClient';
import { managedVoicePollDelayMs } from '../../services/clients/managedVoicePolling';
import { reportError, describeCause } from '../../lib/diagnostics/report';

export type VoicePrepFailure = 'clip_required' | 'pool_exhausted' | 'voice_failed' | 'unavailable';

export type VoicePrepResult =
  | { ok: true; voiceId: string }
  | { ok: false; reason: VoicePrepFailure };

export interface PrepareManagedVoiceDeps {
  client: ManagedVoicesClient;
  loadClip: () => Promise<Blob | null>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Caller cancellation — e.g. MainPanel's start-scoped aborter, threaded in
   *  as `ports.signal` by `KizunaAISonioxProviderConfig.prepareToStart`.
   *  Threaded into every `ensure`/`mine` call so a cancel reaches the network
   *  (not just gates the NEXT attempt), and additionally checked at every
   *  loop boundary below the deadline already is. Optional: a caller with no
   *  cancellation concept simply omits it, and behaviour is unchanged from
   *  before this parameter existed. */
  signal?: AbortSignal;
  /** Budget for STARTING work — NOT a wall-clock ceiling on this call.
   *
   *  Every new attempt (a poll, the clip upload after `clip_required`, the
   *  retry after `pool_exhausted`) is refused once this has elapsed. Without
   *  `signal`, an attempt already in flight keeps running on
   *  `ManagedVoicesClient`'s own timeout — 15 s, or 120 s once a clip is
   *  attached — and is never aborted from here.
   *
   *  So the NO-SIGNAL worst case is roughly `timeoutMs` + that upload
   *  timeout. A concrete one at the defaults: a warm `ensure` that burns its
   *  full ~15 s before answering `clip_required` still passes the deadline
   *  check, and may then start a 120 s upload — about 135 s of Start being
   *  disabled with no cancel, against a stated 60 s ceiling.
   *
   *  With `signal` supplied that figure no longer applies: an in-flight
   *  `ensure`/`mine` aborts too (ManagedVoicesClient forwards it into its own
   *  AbortController, keeping the caller's cancel distinguishable from its
   *  own deadline at the catch site — see SonioxTtsRest.synthesizeOnce, the
   *  precedent for that shape), and a cancel observed at a loop boundary
   *  resolves through the same degrade path deadline exhaustion already
   *  does. `KizunaAISonioxProviderConfig.prepareToStart` always supplies one
   *  (`ports.signal`), so 135 s is a bound this codebase's only caller no
   *  longer hits in practice. */
  timeoutMs?: number;
  /** Wait before readiness poll number `attempt` (0-based). Defaults to the
   *  schedule shared with the settings panel (`managedVoicePolling.ts`);
   *  tests inject a constant. */
  pollDelayMs?: (attempt: number) => number;
}

const DEFAULT_RETRY_MS = 3000;

export async function prepareManagedVoice(deps: PrepareManagedVoiceDeps): Promise<VoicePrepResult> {
  const {
    client,
    loadClip,
    signal,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    now = () => Date.now(),
    timeoutMs = 60_000,
    pollDelayMs = managedVoicePollDelayMs,
  } = deps;

  const deadline = now() + timeoutMs;

  try {
    // Warm-path first, deliberately without the clip: a cached voice needs no
    // upload at all, and the clip can be 10 MB.
    const ensured = await ensureOnce(undefined);
    if (!ensured.ok) return ensured;

    if (ensured.value.status === 'ready') return { ok: true, voiceId: ensured.value.voiceId };

    let attempt = 0;
    for (;;) {
      const remaining = deadline - now();
      // A cancelled caller resolves through the exact same degrade result a
      // spent deadline does — 'unavailable' — rather than a fourth branch:
      // both mean "stop trying, the session starts without this voice".
      if (remaining <= 0 || signal?.aborted) return { ok: false, reason: 'unavailable' };
      // Clamp the wait AND re-check after it. Checking only before the sleep
      // let a full interval step straight over the deadline and then start a
      // poll anyway — and that poll carries its own 15s request timeout, so
      // Start stayed disabled well past the budget it had just been told it
      // was out of. The rule everywhere in this routine is the same: no new
      // attempt may BEGIN after the deadline (or after a cancel).
      await sleep(Math.min(pollDelayMs(attempt++), remaining));
      // The poll gets the budget too, not just permission to start: `mine`
      // otherwise runs its own fixed 15s timeout, so a poll beginning just
      // inside the deadline still finishes outside it.
      const budgetMs = deadline - now();
      if (budgetMs <= 0 || signal?.aborted) return { ok: false, reason: 'unavailable' };
      // `mine(budgetMs, signal)` vs `mine(budgetMs)`: passing `undefined`
      // explicitly (rather than omitting the argument) would still change
      // the call's arity, which a test double built with a plain mock
      // function distinguishes from a one-argument call — so the second
      // argument is only ever supplied when there is one.
      const voice = signal ? await client.mine(budgetMs, signal) : await client.mine(budgetMs);
      // A vanished row means another device superseded this build or the LRU
      // evicted it. Rebuilding here would race the same way again.
      if (!voice) return { ok: false, reason: 'voice_failed' };
      if (voice.status === 'ready') return { ok: true, voiceId: voice.voiceId };
      if (voice.status === 'failed') return { ok: false, reason: 'voice_failed' };
    }
  } catch (error) {
    // The returned reason is a category ('unavailable'); the cause it came from
    // survives nowhere else, and the user only sees that their voice did not
    // prepare.
    reportError('ManagedVoice', `Voice preparation failed: ${describeCause(error)}`, { cause: error });
    return { ok: false, reason: 'unavailable' };
  }

  /** One `ensure`, with the two refusals that have a next move: `clip_required`
   *  (upload this device's clip) and `pool_exhausted` (wait out the backend's
   *  own hint, once). Both are attempted at most once, so Start is never held
   *  open by a loop that cannot make progress. */
  async function ensureOnce(
    clip: Blob | undefined,
    opts: { retriedPool?: boolean; retriedClip?: boolean } = {}
  ): Promise<{ ok: true; value: { voiceId: string; status: 'ready' | 'processing' } } | { ok: false; reason: VoicePrepFailure }> {
    try {
      // pin: true — this slot must survive until the session's own lease takes
      // over the pin at session-started.
      //
      // budgetMs hands the client what is LEFT of our deadline. Refusing to
      // begin an attempt after expiry (below) bounds when a request starts;
      // this bounds how long one may run. Without it a cold upload keeps its
      // own 120s timeout and blows straight through a 60s preparation budget,
      // with Start disabled and no way to cancel — the two together are what
      // make timeoutMs an actual ceiling rather than a hopeful one.
      const value = await client.ensure({ pin: true, clip, budgetMs: deadline - now(), signal });
      return { ok: true, value };
    } catch (error) {
      if (!(error instanceof SonioxVoicesError)) {
        reportError('ManagedVoice', `Voice ensure failed: ${describeCause(error)}`, { cause: error });
        return { ok: false, reason: 'unavailable' };
      }
      if (error.errorType === 'clip_required' && !opts.retriedClip) {
        // Never START a retry once the deadline is already gone (or the
        // caller has cancelled): a warm attempt that itself consumed most of
        // the budget must not be followed by up to a 120s upload against a
        // stated (e.g.) 60s ceiling. 'unavailable' reads truer than
        // 'clip_required' here — the device DOES have a clip, we simply ran
        // out of time (or permission) to send it, and 'clip_required's own
        // copy ("record one in Settings") would be actively wrong.
        if (now() >= deadline || signal?.aborted) return { ok: false, reason: 'unavailable' };
        const stored = await loadClip();
        // No clip here means this device has never recorded one. Warm slots
        // follow the user anywhere; a cold slot cannot, by design.
        if (!stored) return { ok: false, reason: 'clip_required' };
        // Re-checked AFTER the read, not only before it: pulling a clip of up
        // to 10 MB out of IndexedDB can itself outlast what was left, and the
        // upload that follows is the most expensive thing this routine does.
        if (now() >= deadline || signal?.aborted) return { ok: false, reason: 'unavailable' };
        return ensureOnce(stored, { ...opts, retriedClip: true });
      }
      if (error.errorType === 'pool_exhausted' && !opts.retriedPool) {
        // Same ceiling, same reasoning as clip_required above, plus: never
        // trust the server's own retry-after hint past what's actually left
        // in the budget — a reconciler bug returning e.g. a ten-minute hint
        // must not hang Start for anywhere near that long.
        const remaining = deadline - now();
        if (remaining <= 0 || signal?.aborted) return { ok: false, reason: 'unavailable' };
        await sleep(Math.min(error.retryAfterMs ?? DEFAULT_RETRY_MS, remaining));
        if (now() >= deadline || signal?.aborted) return { ok: false, reason: 'unavailable' };
        return ensureOnce(clip, { ...opts, retriedPool: true });
      }
      if (error.errorType === 'pool_exhausted') return { ok: false, reason: 'pool_exhausted' };
      if (error.errorType === 'clip_required') return { ok: false, reason: 'clip_required' };
      // Falls through for every other errorType, including 'aborted': a
      // client request that lost the race with the caller's own cancel (or
      // was refused outright because the signal was already aborted) has no
      // more of a "next move" than a plain network failure does, so it
      // resolves through the exact same degrade path — deliberately not a
      // fifth `if` branch of its own.
      return { ok: false, reason: 'unavailable' };
    }
  }
}

/** The sentence to show once the session is up. Separate from the routine so
 *  the routine stays free of i18n, and so the copy can be reviewed as copy. */
export function voicePrepNotice(reason: VoicePrepFailure): { key: string; defaultValue: string } {
  switch (reason) {
    case 'clip_required':
      return {
        key: 'mainPanel.sonioxVoiceClipMissing',
        defaultValue: 'This device has no voice recording, so this session uses a built-in voice. Record one in Settings to speak in your own voice here.',
      };
    case 'pool_exhausted':
      return {
        key: 'mainPanel.sonioxVoicePoolBusy',
        defaultValue: 'All custom voice slots are in use right now, so this session uses a built-in voice. Your own voice will be used again next time.',
      };
    case 'voice_failed':
      return {
        key: 'mainPanel.sonioxVoiceBuildFailed',
        defaultValue: 'Your custom voice could not be built, so this session uses a built-in voice. Try recording a clearer clip in Settings.',
      };
    case 'unavailable':
    default:
      return {
        key: 'mainPanel.sonioxVoiceUnavailable',
        defaultValue: 'Your custom voice is unavailable right now, so this session uses a built-in voice.',
      };
  }
}

export interface VoicePrepOutcome {
  /** The voice id THIS SESSION should actually use: the freshly prepared id
   *  on success, or the built-in fallback on failure. Never null — the
   *  caller only reaches this function once it has already decided a prep
   *  attempt was worth making. */
  sessionVoice: string;
  /** Settings-store patch to write through, or null when nothing should be
   *  persisted. */
  settingsPatch: { voice: string } | null;
  /** i18n notice to show after the session is up, or null on success. */
  notice: { key: string; defaultValue: string } | null;
}

/**
 * Turn a `prepareManagedVoice()` result into the three decisions
 * `KizunaAISonioxProviderConfig.prepareToStart` actually needs to make: what
 * voice this session uses, whether to persist a changed id, and what (if
 * anything) to tell the user afterwards.
 *
 * Pure and side-effect free on purpose — unlike `prepareManagedVoice`
 * itself, which performs the network calls, this is just the branching a
 * caller does on its result. Extracted out of `connectConversation` and
 * exported specifically so this decision — most importantly the ASYMMETRIC
 * write (persist only a genuinely CHANGED successful id; a fallback is
 * never persisted, so a busy pool tonight cannot silently demote the user's
 * stored preference) — can be imported and tested directly (see
 * `voicePrepWiring.test.ts`) rather than hand-transcribed into a test
 * double. The caller still owns every actual side effect: the
 * `updateProviderSlice` store write and the `sessionConfig` mutation; the
 * `t()` translation of `notice` happens in the hook itself
 * (`KizunaAISonioxProviderConfig.prepareToStart`) — none of which belong in
 * a routine this file's other exports keep React- and i18n-free.
 */
export function resolveVoicePrepOutcome(
  result: VoicePrepResult,
  storedVoiceId: string,
  builtinFallbackVoice: string
): VoicePrepOutcome {
  if (result.ok) {
    return {
      sessionVoice: result.voiceId,
      // Write through ONLY when the id actually changed: a rebuild returns
      // a new Soniox UUID and the stored preference must follow it; an
      // unchanged (warm-hit) id must not cause a redundant store write.
      settingsPatch: result.voiceId !== storedVoiceId ? { voice: result.voiceId } : null,
      notice: null,
    };
  }
  return {
    // Applies to THIS SESSION only — never persisted.
    sessionVoice: builtinFallbackVoice,
    settingsPatch: null,
    notice: voicePrepNotice(result.reason),
  };
}
