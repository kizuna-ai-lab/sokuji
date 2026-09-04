/**
 * Soniox voice picker + voice cloning, wrapping the shared VoiceLibrarySection
 * (dropdown presentation): 28 built-ins as the preset group, cloned voices
 * (fetched live via the injected `source`) as the custom group. Where those
 * voices come from — BYOK talking to Soniox directly, or a managed account
 * talking to our backend — is entirely the caller's concern; see
 * `voiceLibrarySource.ts` for the seam. A null `source` (BYOK with no API key
 * pasted yet, or a managed account with no session) renders built-ins only.
 *
 * Create flow: record/upload are always available once a source exists (the
 * shared voice-library look, no gating checkbox) → client-side validation
 * (upload only: ≤35 MB, decoded duration 3-120s, mirroring NativeVoiceSection's
 * `validateVoiceClip` pattern) → the validated/recorded clip is staged as
 * `pending` rather than uploaded immediately, which opens
 * `SonioxCloneConfirmModal` for playback + naming + the consent statement
 * (folded into the modal's accept button) → on confirm, WAV-encode
 * (recordings only) → POST → poll until ready (seconds) → auto-select. A
 * mapped create failure (e.g. `voice_name_conflict`) keeps the modal open so
 * the user can rename and retry without losing the clip. `voice_failed` is
 * terminal: the entry renders a failed hint and can only be deleted.
 *
 * Managed accounts additionally cannot REPLACE a healthy voice by recording
 * again — the backend hands back the voice it already has and ignores the new
 * clip — so the create affordances are withdrawn while one exists, with a note
 * saying to delete first. See `managedVoiceBlocksCreate` below.
 *
 * Previewing (auditioning) a voice is a separate capability from the
 * create/delete affordances above: it needs a Soniox key to synthesize a
 * sample, which a managed account's source does not have, so it is gated on
 * `source.canPreview` rather than on `source` merely being non-null.
 */
import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceLibrarySection, { type VoiceEntry } from './VoiceLibrarySection';
import SonioxCloneConfirmModal from './SonioxCloneConfirmModal';
import {
  SonioxVoicesError,
  encodeWavPcm16,
  type SonioxVoice,
} from '../../../services/clients/SonioxVoicesClient';
import { synthesizeOnce } from '../../../services/clients/SonioxTtsRest';
import { asSonioxRegion } from '../../../lib/soniox/regions';
import { previewSampleFor } from './sonioxPreviewSample';
import { SonioxProviderConfig, clampNumber } from '../../../services/providers/SonioxProviderConfig';
import { SONIOX_TTS_MODEL, SONIOX_DEFAULT_VOICE } from '../../../lib/soniox/ttsCatalog';
import {
  validateVoiceClip,
  downmixToMono,
  type ClipValidationError,
} from '../../../lib/local-inference/native/nativeVoiceStores';
import type { VoiceLibrarySource } from './voiceLibrarySource';

export interface SonioxVoiceSectionProps {
  /** `targetLanguage` and `ttsSpeed` drive the preview audition so it matches
   *  what the session would actually speak. `apiKey` is BYOK-only and is
   *  empty for managed accounts — the preview path is gated on
   *  `source.canPreview`, not on this field. */
  settings: {
    voice: string;
    apiKey: string;
    targetLanguage: string;
    ttsSpeed: number;
    /** Which Soniox deployment `apiKey` belongs to, so the preview is
     *  synthesized on the host that key authenticates against. Optional so the
     *  existing tests' fixtures keep compiling; absent reads as US. */
    region?: string;
  };
  onUpdate: (patch: { voice: string }) => void;
  /** Where voices come from, or null when this account cannot manage any yet
   *  (BYOK with no API key pasted; managed with no signed-in user). Null
   *  keeps the create/delete affordances hidden rather than reaching a null
   *  crash — for managed specifically, this is also what stops a signed-out
   *  user from recording a clip that would be saved locally and then rejected
   *  by the backend. The caller mints a NEW `source` object whenever the
   *  signed-in account changes (not just when it signs in/out), so this
   *  component's account-scoped state (the fetched list, the preview cache)
   *  is never carried over from one account to another. */
  source: VoiceLibrarySource | null;
  /** Copy variant. Drives: the custom-voice label (managed shows "My voice"
   *  rather than the backend's internal name), the list-error copy, and —
   *  via the confirm modal's `notice`/`showName` props — the managed-only
   *  data-destination statement and the hidden name field (the backend names
   *  voices itself). */
  managed: boolean;
  isSessionActive: boolean;
}

const BUILTIN_VOICES = new SonioxProviderConfig().getConfig().voices;
const TTS_MODEL = SONIOX_TTS_MODEL;
const DEFAULT_VOICE = SONIOX_DEFAULT_VOICE;
// Reference-clip bounds Soniox documents for `/v1/voices`, validated
// client-side because the two are enforced at DIFFERENT points server-side:
// size is rejected at upload, but duration is accepted at upload and only
// fails later, per model, as `voice_audio_too_long` — a terminal `failed`
// status that has already spent one of the organization's 20 voice slots and
// a billable create. So the duration bound below is the only thing standing
// between a too-long clip and a slot the user has to notice and clean up.
// (These are Soniox's own numbers — deliberately NOT validateVoiceClip's
// local-model defaults, which NativeVoiceSection keeps at 3-20s.)
const MIN_CLIP_SECONDS = 3;
const MAX_CLIP_SECONDS = 120;
// Soniox says "stay within 35 MB"; read as decimal, the smaller of the two
// plausible readings, so we never wave through what the server would reject.
// The bound that actually matters day to day is MAX_CLIP_SECONDS: a full
// 2-minute capture at a 48 kHz AudioContext encodes to ~11.5 MB of PCM16 WAV,
// so recordings clear this with room to spare and only imports can hit it.
const MAX_UPLOAD_BYTES = 35 * 1000 * 1000;

/** How long to wait for a container's metadata before giving up and letting the
 *  decode decide. Metadata is the first few KB of the file, so this is generous. */
const DURATION_PROBE_TIMEOUT_MS = 5_000;

/** Duration from container metadata, WITHOUT decoding the audio.
 *
 *  `decodeAudioData` materializes the entire file as Float32 PCM: a 34 MB
 *  32 kbps MP3 holds ~2.4 hours, which expands past 3 GB and can take the
 *  renderer down before we ever get to reject it for length. Under the old
 *  10 MiB size gate a file that long was refused on size alone; at 35 MB it is
 *  not, so duration has to be knowable BEFORE the decode.
 *
 *  Returns null whenever the browser won't say — a non-Blob, no metadata event,
 *  a duration of Infinity/NaN (streamed containers), or an unparseable file. The
 *  caller then falls through to the decode, which is exactly the old behavior:
 *  this probe can reject early, never accept early, so a browser that declines
 *  to answer costs correctness nothing. */
async function probeDurationSeconds(file: File): Promise<number | null> {
  // createObjectURL is specified over Blob; test doubles and exotic File-likes
  // are not, and calling it on one throws rather than returning null.
  if (typeof URL.createObjectURL !== 'function' || !(file instanceof Blob)) return null;
  let url: string;
  try {
    url = URL.createObjectURL(file);
  } catch {
    return null;
  }
  try {
    return await new Promise<number | null>((resolve) => {
      const el = new Audio();
      el.preload = 'metadata';
      let settled = false;
      const finish = (v: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Stop the element from holding the (about to be revoked) URL.
        el.removeAttribute('src');
        resolve(v);
      };
      const timer = setTimeout(() => finish(null), DURATION_PROBE_TIMEOUT_MS);
      el.addEventListener('loadedmetadata', () => {
        const d = el.duration;
        finish(Number.isFinite(d) && d > 0 ? d : null);
      });
      el.addEventListener('error', () => finish(null));
      el.src = url;
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function isReady(v: SonioxVoice): boolean {
  return v.models?.some((m) => m.model === TTS_MODEL && m.status === 'ready') ?? false;
}
function isFailed(v: SonioxVoice): boolean {
  return v.models?.some((m) => m.model === TTS_MODEL && m.status === 'failed') ?? false;
}

const SonioxVoiceSection: React.FC<SonioxVoiceSectionProps> = ({
  settings,
  onUpdate,
  source,
  managed,
  isSessionActive,
}) => {
  const { t } = useTranslation();
  // Latest-value ref so an in-flight `refresh()` can tell, at resolution
  // time, whether the source it was issued against is still current — an
  // explicit guard alongside the generation counter below rather than
  // relying solely on effect-cleanup ordering when `source` changes mid-fetch.
  const sourceRef = useRef(source);
  useEffect(() => { sourceRef.current = source; }, [source]);
  const [clones, setClones] = useState<SonioxVoice[]>([]);
  // Start 'loading' whenever a source exists so the first paint never shows
  // the "(deleted voice)" placeholder for a settings.voice that simply
  // hasn't been checked against the fetched list yet.
  const [listState, setListState] = useState<'idle' | 'loading' | 'error'>(source ? 'loading' : 'idle');
  const [captureError, setCaptureError] = useState<string | null>(null);
  // A clip that's been picked/recorded and passed client-side validation,
  // staged for the confirm modal (playback + naming + consent) before it's
  // actually uploaded. Non-null ⇔ the modal is open.
  const [pending, setPending] = useState<{ blob: Blob; fileName?: string; suggestedName: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  // Bumped every time a NEW clip is staged (not on a confirm-error retry,
  // which reuses the same `pending`) and handed to the modal as `key` — a
  // fresh mount per capture means the name field's initial value is right
  // the first time, with no effect-driven resync race against the DOM
  // assertions in tests (or the user's eyes).
  const [pendingSeq, setPendingSeq] = useState(0);
  const stagePending = (next: { blob: Blob; fileName?: string; suggestedName: string }) => {
    setPending(next);
    setPendingSeq((s) => s + 1);
  };
  // Refresh results landing after unmount (or after the key changed) must not
  // write state; the counter invalidates in-flight loads.
  const loadGeneration = useRef(0);

  const refresh = useCallback(async () => {
    if (!source) return;
    const requestSource = source;
    const generation = ++loadGeneration.current;
    setListState('loading');
    try {
      const voices = await requestSource.list();
      if (generation !== loadGeneration.current || sourceRef.current !== requestSource) return;
      setClones(voices);
      setListState('idle');
    } catch {
      if (generation !== loadGeneration.current || sourceRef.current !== requestSource) return;
      setListState('error');
    }
  }, [source]);

  useEffect(() => {
    // A changed source means a (possibly) different voice project: the old
    // project's clones must not stay listed/selectable while the new fetch is
    // pending — or forever, if it fails. Manual refresh() calls (the toolbar
    // button) deliberately keep the current list until fresh data lands.
    setClones([]);
    void refresh();
    return () => { loadGeneration.current++; };
  }, [refresh]);

  const mapCreateError = (e: unknown): Error => {
    if (e instanceof SonioxVoicesError) {
      if (e.errorType === 'voice_name_conflict') {
        return new Error(t('settings.sonioxVoiceNameConflict', 'A voice with this name already exists'));
      }
      if (e.errorType === 'limit_exceeded' || e.status === 429) {
        return new Error(
          t('settings.sonioxVoiceQuotaError', 'Soniox organization voice limit reached — delete a voice and retry')
        );
      }
      if (e.errorType === 'voice_failed') {
        return new Error(t('settings.sonioxVoiceFailed', 'Processing failed — delete this voice and try a clearer clip'));
      }
      if (e.errorType === 'pool_exhausted') {
        return new Error(t('settings.sonioxVoicePoolExhausted', 'All custom voice slots are in use right now — please try again in a moment.'));
      }
      if (e.errorType === 'voice_pinned') {
        return new Error(t('settings.sonioxVoicePinned', 'This voice is in use by a running session — end the session before deleting it.'));
      }
      if (e.errorType === 'insufficient_balance') {
        return new Error(t('settings.sonioxVoiceInsufficientBalance', 'Add balance to your account before building a custom voice.'));
      }
      if (e.errorType === 'authentication_required') {
        return new Error(t('settings.sonioxVoiceSignInRequired', 'Sign in to build a custom voice.'));
      }
      if (e.errorType === 'clip_clear_failed') {
        // Half a delete: the voice is gone, the recording it was built from
        // is not. Saying "delete failed" would be the wrong half, and saying
        // nothing would leave biometric material on the device under a claim
        // that it was removed. The remedy is NOT "delete again" — by the time
        // this shows, the voice row is gone from the list and there is no
        // delete button left to press. Recording a new voice overwrites the
        // clip (one record, replaced by whoever saves next), which is the
        // only in-app action that actually removes it.
        return new Error(
          t(
            'settings.sonioxVoiceClipClearFailed',
            'Your voice was deleted, but its recording could not be removed from this device. Nothing uses it now — recording a new voice replaces it.'
          )
        );
      }
    }
    return e instanceof Error ? e : new Error(String(e));
  };

  // Separate from mapCreateError: those branches are all voices-CRUD specific
  // (name conflicts, voice quota, terminal processing failure), none of which
  // a synthesis call can produce.
  const mapTtsError = (e: unknown): Error => {
    if (e instanceof SonioxVoicesError) {
      if (e.status === 401 || e.errorType === 'unauthenticated') {
        return new Error(t('settings.sonioxVoicePreviewAuthError', 'Preview failed — check the API key'));
      }
      if (e.status === 429 || e.errorType === 'limit_exceeded') {
        return new Error(t('settings.sonioxVoicePreviewQuotaError', 'Preview failed — Soniox rate limit or quota reached'));
      }
      if (e.errorType === 'timeout') {
        return new Error(t('settings.sonioxVoicePreviewTimeout', 'Preview timed out — try again'));
      }
    }
    return e instanceof Error ? e : new Error(String(e));
  };

  // Synthesized samples are effectively deterministic for a fixed text, so a
  // repeat listen carries no new information but would spend the user's tokens
  // again. Keyed by voice + language + speed so changing either re-synthesizes.
  const previewCacheRef = useRef(new Map<string, { audio: Float32Array; sampleRate: number }>());
  // A changed source means a (possibly) different voice project: audio cached
  // against the old project's UUIDs must not replay under the new key.
  useEffect(() => { previewCacheRef.current.clear(); }, [source]);

  const handlePreview = useCallback(async (
    id: string,
    signal?: AbortSignal
  ): Promise<{ audio: Float32Array; sampleRate: number } | null> => {
    if (!source?.canPreview) return null;
    // Pinned for the post-await staleness check below — same guard the
    // list/create paths use via sourceRef.
    const requestSource = source;
    const sample = previewSampleFor(settings.targetLanguage);
    // Same choke point the session path uses (SonioxProviderConfig.
    // buildSessionConfig): the slider already constrains this in practice, so
    // clamping here is defensive, but the two paths reading the same setting
    // should agree on its bounds rather than one trusting the raw value.
    const speed = clampNumber(settings.ttsSpeed, 0.7, 1.3, 1.0);
    const cacheKey = `${id}|${sample.language}|${speed}`;
    setCaptureError(null);
    const cached = previewCacheRef.current.get(cacheKey);
    if (cached) return cached;
    try {
      const result = await synthesizeOnce({
        apiKey: settings.apiKey,
        region: asSonioxRegion(settings.region),
        voice: id,
        language: sample.language,
        text: sample.text,
        speed,
        signal,
      });
      // The key may have been swapped while this was in flight. The effect
      // above already cleared the cache at swap time, so writing now would
      // reseed the NEW project's cache with the OLD project's audio — and
      // returning it would play another project's voice under this key.
      // Discard instead; nothing was cancelled, so the user simply hears
      // nothing and can click again.
      if (sourceRef.current !== requestSource) return null;
      previewCacheRef.current.set(cacheKey, result);
      return result;
    } catch (e) {
      // A user-initiated cancel (switching rows, closing the panel) is not a
      // failure and must never reach the banner.
      if (e instanceof SonioxVoicesError && e.errorType === 'aborted') return null;
      setCaptureError(mapTtsError(e).message);
      return null;
    }
  }, [source, settings.apiKey, settings.targetLanguage, settings.ttsSpeed, t]);

  // Latest selection, read at auto-select time: the ready-wait below runs for
  // up to a minute in the background, and a choice the user made meanwhile
  // must not be silently overwritten.
  const selectedVoiceRef = useRef(settings.voice);
  useEffect(() => { selectedVoiceRef.current = settings.voice; }, [settings.voice]);

  const finishCreate = async (
    created: SonioxVoice,
    createSource: VoiceLibrarySource,
    selectionAtCreate: string
  ) => {
    try {
      await createSource.waitUntilReady(created.id);
    } finally {
      // Refresh regardless of outcome: a `voice_failed` rejection still needs
      // the now-failed entry to show up (with its failed hint) so it can be
      // deleted. (refresh() self-invalidates if the source changed meanwhile.)
      await refresh();
    }
    // Auto-select only while the world hasn't moved: the source is still the
    // one the voice was created under (a swapped source must not inherit an
    // old project's UUID), and the user hasn't picked a different voice while
    // the clone was processing.
    if (sourceRef.current !== createSource) return;
    if (selectedVoiceRef.current !== selectionAtCreate) return;
    onUpdate({ voice: created.id });
  };

  const defaultName = () => t('settings.sonioxVoiceDefaultName', 'My Voice {{n}}', { n: clones.length + 1 });

  // Modal lifecycle: `pending` non-null opens SonioxCloneConfirmModal.
  // `closeModal` is also handed to the modal as its Cancel/backdrop/X
  // handler, guarded against `modalBusy` so a create() request in flight
  // can't be orphaned by a mid-request cancel.
  const closeModal = () => {
    if (modalBusy) return;
    setPending(null);
    setModalError(null);
  };

  // Confirm step: calls create(), then refreshes the list BEFORE closing the
  // modal — closing right after create() (the old behavior) meant the list
  // didn't yet contain the new voice for a beat, which read as the create
  // having silently failed. The modal now stays open (busy, spinner showing)
  // through both the create request and this refresh, so by the time it
  // closes the new voice is already visible with its "processing…" badge.
  // The waitUntilReady → refresh → auto-select chain then continues in the
  // background; a late (post-close) failure there (e.g. voice_failed)
  // surfaces in the existing captureError banner rather than reopening the
  // modal. On a create() failure (e.g. voice_name_conflict), keep the modal
  // open with the mapped message inline so the user can rename and retry
  // without losing the clip.
  const handleConfirm = async (name: string) => {
    if (!source || !pending || modalBusy) return;
    const createSource = source;
    const selectionAtCreate = settings.voice;
    setModalBusy(true);
    setModalError(null);
    try {
      const created = await createSource.create(name.trim() || pending.suggestedName, pending.blob, pending.fileName);
      await refresh();
      setPending(null);
      setModalBusy(false);
      try {
        await finishCreate(created, createSource, selectionAtCreate);
      } catch (e) {
        setCaptureError(mapCreateError(e).message);
      }
    } catch (e) {
      setModalError(mapCreateError(e).message);
      setModalBusy(false);
    }
  };

  // No create call here — the encoded clip is staged as `pending` and the
  // confirm modal drives the actual upload via handleConfirm above.
  const onRecord = async (clip: Float32Array, sampleRate: number) => {
    setCaptureError(null);
    stagePending({ blob: encodeWavPcm16(clip, sampleRate), suggestedName: defaultName() });
  };

  // Maps a validateVoiceClip verdict to the same voiceLibrary.* copy
  // NativeVoiceSection uses, substituting this section's own bounds.
  const mapClipError = (reason: ClipValidationError): string => {
    switch (reason) {
      case 'too_short':
        return t('voiceLibrary.clipTooShort', 'Recording is too short — speak for at least {seconds} seconds.')
          .replace('{seconds}', String(MIN_CLIP_SECONDS));
      case 'too_long':
        return t('voiceLibrary.clipTooLong', 'Recording is too long — keep it under {seconds} seconds.')
          .replace('{seconds}', String(MAX_CLIP_SECONDS));
      case 'silent':
      default:
        return t('voiceLibrary.clipSilent', 'No voice detected — check your microphone and try again.');
    }
  };

  // Client-side upload validation (spec: "client-side decode validates
  // 3-120s / ≤35MB via the validateVoiceClip pattern"): reject an oversize
  // file outright (cheap, no decode needed), then decode the file to measure
  // its REAL duration — a file's extension/MIME claims nothing about actual
  // length — and run it through the same validateVoiceClip bounds
  // NativeVoiceSection uses. A validation failure surfaces inline via
  // captureError and rethrows (VoiceLibrarySection's contract) without
  // opening the modal. On success, no create() call is made here — the
  // validated file is staged as `pending` so the confirm modal can play it
  // back and take a name before it's uploaded.
  const onImport = async (file: File) => {
    setCaptureError(null);
    try {
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(
          t('voiceLibrary.importError', 'Import failed: {error}').replace(
            '{error}',
            // Both figures in the SAME unit as the published limit (decimal
            // MB), so "36.0 MB, max 35 MB" reads as one comparison. Dividing
            // the cap by 1024^2 while quoting it as "MB" would print 33.4 —
            // a number that appears nowhere in Soniox's docs.
            `File is too large (${(file.size / 1_000_000).toFixed(1)} MB, max ${MAX_UPLOAD_BYTES / 1_000_000} MB)`
          )
        );
      }
      // Cheap length gate before the expensive one. Only `too_long` is worth
      // catching here: an over-long file is precisely the one whose decode can
      // exhaust the renderer, while a too-short or silent file is small by
      // construction and is caught below on the decoded samples, where the
      // measurement is exact.
      const probed = await probeDurationSeconds(file);
      if (probed !== null && probed > MAX_CLIP_SECONDS) throw new Error(mapClipError('too_long'));
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new AudioContext();
      let buffer: AudioBuffer;
      try {
        buffer = await ctx.decodeAudioData(arrayBuffer);
      } catch {
        throw new Error(
          t('voiceLibrary.decodeFailed', 'Could not read that audio file — try a WAV, MP3, or other common format.')
        );
      } finally {
        void ctx.close();
      }
      const reason = validateVoiceClip(downmixToMono(buffer), buffer.sampleRate, MAX_CLIP_SECONDS, MIN_CLIP_SECONDS);
      if (reason) throw new Error(mapClipError(reason));
      const stripped = file.name.replace(/\.[^.]+$/, '');
      stagePending({ blob: file, fileName: file.name, suggestedName: stripped || defaultName() });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setCaptureError(err.message);
      throw err;
    }
  };

  const onDelete = async (id: string) => {
    if (!source) return;
    // The live session's SonioxClient captured this voice id at session start
    // and reuses it for every TTS stream — deleting it server-side would break
    // spoken translation for the rest of the session.
    if (isSessionActive && settings.voice === id) {
      setCaptureError(
        t('settings.sonioxVoiceDeleteInUse', 'This voice is being used by the active session — end the session before deleting it')
      );
      return;
    }
    // `clip_clear_failed` is the one failure where the BACKEND delete already
    // succeeded — the voice is gone at Soniox and from our table, and only
    // the on-device recording survived. Bailing out here (as every other
    // failure rightly does) would leave the panel listing a voice that no
    // longer exists and `settings.voice` still pointing at it, so the next
    // Start would 409 `clip_required`, upload the surviving clip, and
    // silently rebuild the voice the user just deleted. The list refresh and
    // the setting reset below therefore run for it too; the clip failure is
    // reported afterwards, once the panel tells the truth about the voice.
    let clipClearFailure: unknown = null;
    try {
      await source.delete(id);
    } catch (e) {
      if (e instanceof SonioxVoicesError && e.errorType === 'clip_clear_failed') {
        clipClearFailure = e;
      } else {
        // VoiceLibrarySection's own catch only console.warns — surface the
        // failure in the banner or a failed delete is silent.
        setCaptureError(mapCreateError(e).message);
        throw e;
      }
    }
    await refresh();
    // Deliberate in-app deletion of the selected voice falls back to the
    // default built-in; an EXTERNAL deletion (e.g. from another client) only
    // ever shows the placeholder below — the stored setting is never rewritten
    // behind the user's back.
    // selectedVoiceRef, not the captured `settings.voice`: two awaits have
    // happened since this closure was created, and a user who picked a
    // different voice meanwhile must not have it reset out from under them.
    // Same guard, for the same reason, as finishCreate's auto-select.
    if (selectedVoiceRef.current === id) onUpdate({ voice: DEFAULT_VOICE });
    if (clipClearFailure) {
      setCaptureError(mapCreateError(clipClearFailure).message);
      throw clipClearFailure;
    }
  };

  // The managed backend names voices itself (`u_<account>_<token>`) and never
  // shows that name to anyone, so the section supplies the label instead of
  // rendering an internal identifier at the user.
  const managedName = useCallback(
    (v: SonioxVoice) => (managed ? t('settings.sonioxManagedVoiceName', 'My voice') : v.name),
    [managed, t]
  );

  // A managed account that already holds a healthy voice CANNOT replace it by
  // re-recording: the backend's POST /ensure returns the existing voice and
  // ignores the uploaded clip entirely, rebuilding only when the voice is
  // gone at Soniox or terminally failed. Offering record/import here would
  // therefore report success, overwrite the on-device clip, hand back the
  // same voice id — and change nothing the user can hear, with nothing to
  // explain why. Hide the create affordances and say what is actually true:
  // the current voice has to be deleted first.
  //
  // Deliberately NOT a delete-then-create flow: a delete that succeeds
  // followed by a create that fails would leave the user with no voice at all
  // and a slot handed to somebody else.
  //
  // `isFailed` is the exception because it is also the backend's: a terminally
  // failed voice IS rebuilt from a fresh clip, so re-recording works there and
  // the affordances stay.
  const managedVoiceBlocksCreate = managed && clones.some((v) => !isFailed(v));
  // AN ERRORED LIST IS NOT AN EMPTY LIST. After a failed or unfinished
  // `GET /mine` this panel knows NOTHING about what the account holds:
  // `clones` is `[]` because nothing arrived, not because nothing exists.
  // Both managed-only affordances below decide on exactly that knowledge —
  // one offers to CREATE a voice, the other offers to DESTROY one — so both
  // are withheld until the fetch has actually settled. Reading ignorance as
  // "there is no voice" is what would offer to build a voice that already
  // exists (a no-op the backend answers by handing back the existing one),
  // or to delete a healthy voice the panel merely could not see.
  //
  // Only the success state qualifies: 'loading' has not answered yet, and
  // 'error' never will. The Retry button beside the list error is the way
  // back to a known state.
  const managedListKnown = listState === 'idle';
  const canCreate = !!source && !managedVoiceBlocksCreate && (!managed || managedListKnown);

  const entries = useMemo<VoiceEntry[]>(() => {
    const builtin: VoiceEntry[] = BUILTIN_VOICES.map((v) => ({
      id: v.value,
      label: v.name,
      group: 'builtin',
      removable: false,
    }));
    const custom: VoiceEntry[] = clones.map((v) => ({
      id: v.id,
      label: isFailed(v)
        ? `${managedName(v)} — ${t('settings.sonioxVoiceFailedBadge', 'failed')}`
        : isReady(v)
          ? managedName(v)
          : `${managedName(v)} — ${t('settings.sonioxVoiceProcessingBadge', 'processing…')}`,
      group: 'custom',
      removable: true,
      // A processing/failed clone stays listed (and deletable via the
      // manage list) but can't be picked: a session started with it
      // couldn't synthesize. Auto-select only ever happens post-`ready`.
      disabled: !isReady(v),
    }));
    const known = new Set([...builtin, ...custom].map((e) => e.id));
    // Only synthesize the placeholder once we're not mid-fetch: a settings
    // value pointing at a real (not-yet-loaded) clone must not flash the
    // "(deleted voice)" label before the list arrives. Without a source
    // (no API key yet, or a managed account with no session) there's no
    // fetch to settle at all, so the entry makes no claim about deletion —
    // it shows the raw id rather than asserting something we have no
    // evidence for.
    if (settings.voice && !known.has(settings.voice) && listState !== 'loading') {
      custom.push({
        id: settings.voice,
        label: source
          ? t('settings.sonioxVoiceDeletedPlaceholder', '(deleted voice)')
          : settings.voice,
        group: 'custom',
        // MANAGED, and only once the list is KNOWN: an unknown id here is
        // this account's OWN voice after an eviction — the normal outcome of
        // a small LRU cache serving unbounded users, not an anomaly. Without
        // a delete button the panel would show "(deleted voice)" above "No
        // imported voices yet." with no way forward, the on-device recording
        // would stay there indefinitely, and every later Start would silently
        // re-upload it. The backend's DELETE /mine answers 200 when there is
        // no row, so removing a genuine placeholder is safe and idempotent;
        // it clears the local clip and resets the stale setting.
        //
        // `managedListKnown` is load-bearing, not belt-and-braces. This
        // placeholder also renders when the fetch FAILED — and there the
        // label "(deleted voice)" is a guess, not a fact. `delete` ignores
        // the id and issues an unconditional DELETE /mine, so one click on a
        // row that only LOOKS stale destroys a healthy voice at Soniox AND
        // the reference clip that is the only thing that could rebuild it.
        //
        // BYOK: left alone. There an unknown id means somebody else's
        // project, and the existing rule holds — an external deletion never
        // rewrites the stored setting behind the user's back.
        removable: managed && !!source && managedListKnown,
        // Shows the current selection's state; never a valid new choice.
        disabled: true,
      });
    }
    return [...builtin, ...custom];
  }, [clones, managed, managedName, managedListKnown, settings.voice, listState, source, t]);

  return (
    <div className="settings-section" id="soniox-voice-section">
      <h2>{t('settings.voiceSettings', 'Voice Settings')}</h2>
      {listState === 'error' && (
        <div className="setting-item">
          <div className="setting-description">
            {managed
              ? t('settings.sonioxManagedVoiceListError', 'Could not load your voice — check your connection and try again.')
              : t('settings.sonioxVoiceListError', 'Could not load cloned voices — check the API key.')}{' '}
            <button className="option-button" onClick={() => void refresh()}>
              {t('common.retry', 'Retry')}
            </button>
          </div>
        </div>
      )}
      <VoiceLibrarySection
        voices={entries}
        selectedId={settings.voice}
        onSelect={(id) => onUpdate({ voice: id })}
        onImport={canCreate ? onImport : undefined}
        onRecord={canCreate ? onRecord : undefined}
        onDelete={onDelete}
        onPreview={source?.canPreview ? handlePreview : undefined}
        onRefresh={source ? () => void refresh() : undefined}
        refreshing={listState === 'loading'}
        // Footnote, not a standalone setting: it describes controls that live
        // inside the expanded manage body (the per-row preview button, the
        // record/import buttons), so it belongs there rather than above the
        // collapsed expander where they aren't even visible. The two cases
        // are mutually exclusive — only a managed source can block create,
        // and a managed source can never preview.
        manageNote={
          managedVoiceBlocksCreate
            ? t(
                'settings.sonioxManagedVoiceReplaceHint',
                'Delete this voice before recording a new one — recording again on its own keeps the voice you already have.'
              )
            : source?.canPreview
              ? t(
                  'settings.sonioxVoicePreviewCostHint',
                  'Previewing a voice synthesizes a short clip using your own Soniox quota.'
                )
              : undefined
        }
        capability={{
          importModes: canCreate ? ['record', 'upload'] : [],
          curation: false,
          presentation: 'dropdown',
          accept: 'audio/*',
          maxClipSeconds: MAX_CLIP_SECONDS,
          minClipSeconds: MIN_CLIP_SECONDS,
          // The confirm modal stages exactly one clip; without this a
          // multi-file drop would silently keep only the last file.
          multipleImport: false,
        }}
        isSessionActive={isSessionActive}
      />
      {captureError && (
        <div className="voice-capture-error" role="alert">{captureError}</div>
      )}
      <SonioxCloneConfirmModal
        key={pendingSeq}
        isOpen={pending !== null}
        audioBlob={pending?.blob ?? null}
        error={modalError}
        busy={modalBusy}
        showName={!managed}
        notice={managed
          ? t(
              'settings.sonioxManagedCloneNotice',
              'This recording is sent to Kizuna AI and passed on to Soniox to build your voice. It is not stored on our servers — it stays on this device so your voice can be rebuilt later.'
            )
          : undefined}
        onConfirm={(name) => void handleConfirm(name)}
        onClose={closeModal}
      />
    </div>
  );
};

export default SonioxVoiceSection;
