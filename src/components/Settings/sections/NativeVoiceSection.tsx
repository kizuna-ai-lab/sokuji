import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceLibrarySection, { type VoiceEntry } from './VoiceLibrarySection';
import type { VoiceLibraryCapability } from '../../../types/VoiceLibrary';
import {
  curatedBuiltinVoices,
  eligibleCustomVoices,
  requiresVoiceClip,
  supportsLanguage,
  type VoiceCapability,
} from '../../../lib/local-inference/native/nativeCatalog';
// The selection shown on the picker is resolved by the SAME function the
// client applies at session start, so the panel cannot claim a voice the
// engine will not use.
import { reconcileTtsVoice } from '../../../lib/local-inference/native/nativeTtsVoiceReconciliation';
import type { NativeVoiceInfo } from '../../../lib/local-inference/native/nativeProtocol';
import {
  validateVoiceClip, MIN_CLIP_SECONDS, MAX_CLIP_SECONDS, VoiceCaptureError,
  type ClipValidationError, type NativeCustomVoice, type NativeVoiceStore,
} from '../../../lib/local-inference/native/nativeVoiceStores';
import { VoiceImportError } from '../../../lib/local-inference/voiceStorage';
import { createPreviewTts, type PreviewTtsHandle } from '../../../lib/local-inference/native/nativePreviewTts';
import { resolvePreviewSample } from '../../../lib/tts/previewSample';
import { previewCacheKey, getCachedPreview, setCachedPreview } from '../../../lib/tts/previewCache';
import { reportError, describeCause } from '../../../lib/diagnostics/report';

// The preview audition has no speed control of its own (unlike the session's
// ttsSpeed slider) -- a neutral 1.0 keeps it simple and matches
// NativeTtsClient.generate's own default.
const PREVIEW_SPEED = 1;

// validateVoiceClip now lives in nativeVoiceStores.ts (shared with the
// NativeVoiceStore abstraction). Re-exported here so this file's own test
// keeps working.
export { validateVoiceClip };
export type { ClipValidationError };

/**
 * Native (Electron sidecar) adapter over the generalized VoiceLibrarySection.
 * Switches on the selected TTS model's `VoiceCapability` (Task 10):
 *   - `{builtin:'none', custom:'none'}` → nothing to render.
 *   - otherwise                        → VoiceLibrarySection composed from
 *     the sidecar's built-in voice list (`builtin:<Name>` entries,
 *     curated-first) plus the injected `store`'s custom voices
 *     (`custom:<id>` entries, removable). The old speaker-id slider
 *     (`builtin === 'range'`, `sid:<n>`) died with the ONNX backends that
 *     were its only producers (Task 5's catalog rewire onto native_tts;
 *     swept in Task 7 — R4).
 *
 * The `store` (from `voiceStoreFor`, Task 11) abstracts over the native
 * custom-voice backend — clip cloning (MOSS and the other native_tts clone-
 * capable families) — so this component doesn't need its own store-specific
 * branches. The old style-import backend (Supertonic-shaped native models,
 * uploaded style-vector JSON) died with the ONNX Supertonic backend (Task 5's
 * catalog rewire onto native_tts) and the renderer's setStyleVoice sender
 * (Task 6). It owns loading/refreshing the custom list locally (via
 * `store.list()`) and calls the parent's `onCustomChanged` after a
 * successful mutation so any parent-side cache stays in sync.
 *
 * Capture errors (`VoiceCaptureError` from the clip store; `VoiceImportError`
 * is a shared error type any store could in principle throw) are caught here
 * and surfaced inline; nothing is written to the voice list when validation
 * fails.
 */
export interface NativeVoiceSectionProps {
  /** The selected TTS model's voice capability (built-in shape + custom-voice kind). */
  capability: VoiceCapability;
  /** Built-in voice descriptors from the sidecar (empty when the model isn't downloaded). */
  builtinVoices: NativeVoiceInfo[];
  /** Custom-voice backend for this model; null when `capability.custom === 'none'`. */
  store: NativeVoiceStore | null;
  /** Current settings.ttsVoice (opaque id); empty → default voice for the language. */
  selected: string;
  /** Target language, drives curation ordering + the default voice. */
  targetLanguage: string;
  /** Selected TTS model id — `tts_init`'s `model`. Also the preview synthesis's
   *  model id and the preview cache's namespace (`native:${ttsModelId}`). */
  ttsModelId: string;
  /** That card's `languages` (from the catalog, `nativeProtocol.ts`'s
   *  NativeModelInfo). Drives which language the preview sentence is spoken
   *  in — see `resolvePreviewSample`. */
  ttsLanguages: string[];
  /** Disables voice selection while a session is active. */
  isSessionActive?: boolean;
  /** Write the picked voice id to settings.ttsVoice. */
  onSelect: (id: string) => void;
  /** Notified after a custom voice is imported/recorded/renamed/deleted. */
  onCustomChanged: () => void;
}

const DEFAULT_LIBRARY_CAPABILITY: VoiceLibraryCapability = {
  importModes: [],
};

const NativeVoiceSection: React.FC<NativeVoiceSectionProps> = ({
  capability,
  builtinVoices,
  store,
  selected,
  targetLanguage,
  ttsModelId,
  ttsLanguages,
  isSessionActive = false,
  onSelect,
  onCustomChanged,
}) => {
  const { t } = useTranslation();
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [customVoices, setCustomVoices] = useState<NativeCustomVoice[]>([]);

  // Dedicated sidecar connection for the preview audition, owned by this
  // component -- never nativeModelStore's own connection (that singleton is
  // the long-lived model-management channel). Created lazily on the first
  // preview so opening this panel never pays a sidecar connection + tts_init
  // cost before the user has asked to hear anything, and torn down on
  // unmount so a resident (GB-scale) TTS model's memory goes back when the
  // user leaves the panel.
  const previewTtsRef = useRef<PreviewTtsHandle | null>(null);
  useEffect(() => () => previewTtsRef.current?.close(), []);

  // Guards previewTtsRef's shared client against two overlapping
  // synthesize() calls: nativePreviewTts keeps `client`/`loadedModelId` as
  // unguarded closure state by design (its module doc puts the burden of
  // preventing overlap on the caller). VoiceLibrarySection's
  // `disabled={isLoading}` only blocks a second click on the SAME row, and
  // its abort-on-supersede only discards a superseded call's RESULT, not its
  // still-running promise chain -- so clicking a DIFFERENT custom voice's
  // Play button while the first's (multi-second) synthesis is still in
  // flight is a real, easily reached path to two concurrent synthesize()
  // calls sharing one connection (e.g. one call's setVoice/setReferenceVoice
  // landing between another's applyVoice and generate). Rather than guard
  // inside nativePreviewTts (a caller concern per its own doc comment), skip
  // synthesis for a request that arrives while the shared client is already
  // busy and fall back to the clip -- consistent with every other synthesis
  // problem's fallback below.
  const synthInFlightRef = useRef(false);

  const reloadCustomVoices = useCallback(() => {
    if (!store) { setCustomVoices([]); return; }
    store.list().then(setCustomVoices).catch(() => setCustomVoices([]));
  }, [store]);

  useEffect(() => {
    reloadCustomVoices();
  }, [reloadCustomVoices]);

  const clipErrorMessage = useCallback((reason: ClipValidationError): string => {
    // The limits are per-model (VoiceLibraryCapability) — e.g. OmniVoice
    // accepts at most 8s while others take 20s — so the message must quote
    // the store's actual bound, not the global default.
    const minS = store?.capability.minClipSeconds ?? MIN_CLIP_SECONDS;
    const maxS = store?.capability.maxClipSeconds ?? MAX_CLIP_SECONDS;
    switch (reason) {
      case 'too_short':
        return t('voiceLibrary.clipTooShort', 'Recording is too short — speak for at least {seconds} seconds.')
          .replace('{seconds}', String(minS));
      case 'too_long':
        return t('voiceLibrary.clipTooLong', 'Recording is too long — keep it under {seconds} seconds.')
          .replace('{seconds}', String(maxS));
      case 'silent':
      default:
        return t('voiceLibrary.clipSilent', 'No voice detected — check your microphone and try again.');
    }
  }, [t, store]);

  // Turn a capture failure into a user-facing message: clip validation errors
  // (record/upload on the clip store) map by code; a VoiceImportError (the
  // shared error type from voiceStorage.ts) shows its own message; anything
  // else falls back to a generic "couldn't read that file" notice.
  const captureErrorMessage = useCallback((err: unknown): string => {
    if (err instanceof VoiceCaptureError) return clipErrorMessage(err.code);
    if (err instanceof VoiceImportError) return err.message;
    return t('voiceLibrary.decodeFailed', "Could not read that audio file — try a WAV, MP3, or other common format.");
  }, [clipErrorMessage, t]);

  const handleImport = useCallback(async (file: File, transcript?: string) => {
    if (!store) return;
    setCaptureError(null);
    try {
      // Only forward a transcript arg when the caller actually supplied one,
      // so non-transcript models' store.onImport(file) calls stay untouched.
      if (transcript !== undefined) await store.onImport(file, transcript);
      else await store.onImport(file);
      reloadCustomVoices();
      onCustomChanged();
    } catch (err) {
      // No banner — VoiceCreateModal renders this itself, and it covers the
      // section where the banner would appear. But throw the MAPPED message,
      // not the raw error: the store throws codes ('too_short'), and
      // captureErrorMessage is what turns them into localized copy. A bare
      // rethrow would show the user "Voice clip failed validation: too_short".
      // The throw is also what keeps the transcript field filled in —
      // VoiceLibrarySection only clears it after an awaited onImport resolves.
      throw new Error(captureErrorMessage(err));
    }
  }, [store, reloadCustomVoices, onCustomChanged, captureErrorMessage]);

  const handleRecord = useCallback(async (clip: Float32Array, sampleRate: number, transcript?: string) => {
    if (!store?.onRecord) return;
    setCaptureError(null);
    try {
      if (transcript !== undefined) await store.onRecord(clip, sampleRate, transcript);
      else await store.onRecord(clip, sampleRate);
      reloadCustomVoices();
      onCustomChanged();
    } catch (err) {
      // Same as handleImport: the modal owns the message, it must be the
      // MAPPED one, and the throw keeps the transcript field populated on a
      // failed recording.
      throw new Error(captureErrorMessage(err));
    }
  }, [store, reloadCustomVoices, onCustomChanged, captureErrorMessage]);

  const handleRename = useCallback(async (id: string, name: string) => {
    if (!store || !id.startsWith('custom:')) return;
    const numId = Number(id.slice('custom:'.length));
    if (!Number.isFinite(numId)) return;
    try {
      await store.rename(numId, name);
    } catch (err) {
      // Reported before the copy replaces it: the store rejects with raw
      // internals ("Native voice 3 not found", or whatever IndexedDB raised),
      // and throwing localized copy in its place would otherwise discard the
      // only record of the cause. Same pairing as ModelManagementSection's
      // rename, the other onRename owner.
      reportError('NativeVoiceSection', `Failed to rename voice: ${describeCause(err)}`, { cause: err });
      // Same contract as handleImport/handleRecord: whatever surfaces the
      // failure renders the message verbatim, so the mapping has to happen
      // here. `captureErrorMessage` is wrong for this path — its fallback
      // talks about unreadable audio files — and the store's own text is raw
      // internals ("Native voice 3 not found", or whatever IndexedDB raised).
      // The cause is deliberately not forwarded: nothing downstream reads it,
      // and the picker renders `err.message` straight into the row.
      throw new Error(t('voiceLibrary.renameFailed', 'Could not rename this voice.'));
    }
    reloadCustomVoices();
    onCustomChanged();
  }, [store, reloadCustomVoices, onCustomChanged, t]);

  const handleDelete = useCallback(async (id: string) => {
    if (!store || !id.startsWith('custom:')) return;
    const numId = Number(id.slice('custom:'.length));
    if (!Number.isFinite(numId)) return;
    await store.delete(numId);
    reloadCustomVoices();
    onCustomChanged();
  }, [store, reloadCustomVoices, onCustomChanged]);

  /** The sample sentence for ONE voice: a preset speaks its own language, a
   *  clone speaks the target language. Both are still gated on the model
   *  actually speaking it (`ttsLanguages`), so a voice whose language this
   *  model cannot speak has no sample. `previewUnavailableReason` below is
   *  target-language-only, though, and VoicePicker applies it uniformly to
   *  every row -- so such a preset's ▶ still renders enabled and a click on
   *  it reaches `handlePreview`'s `builtin:` branch, which finds no sample
   *  and returns null silently (a known wart: fixing it would mean a
   *  per-voice previewability reason instead of one shared string, which is
   *  out of scope here). */
  const sampleFor = useCallback(
    (language?: string) =>
      resolvePreviewSample(language || targetLanguage, (l) => supportsLanguage({ languages: ttsLanguages }, l)),
    [targetLanguage, ttsLanguages],
  );

  // The sample sentence for the TARGET language -- used by
  // `previewUnavailableReason` below and by the clone branch of
  // `handlePreview`, which always previews in the target language (unlike a
  // preset, which previews in its own -- see `sampleFor`'s doc comment).
  // `null` means no language clears both gates (the engine speaks it AND the
  // sample table has a sentence for it) -- there is nothing to synthesize
  // with, which is a disabled-reason case below, not an error.
  const previewSample = useMemo(() => sampleFor(), [sampleFor]);

  // Distinct reasons, in priority order: a session holds the sidecar's TTS
  // engine (a panel-issued tts_generate would return _not_owner_error, so
  // refuse up front rather than fail slowly), or there is no sample sentence
  // to synthesize in a language this model speaks.
  const previewUnavailableReason = isSessionActive
    ? t('voiceLibrary.previewNeedsSessionStopped', 'Stop the session to preview this voice.')
    : previewSample === null
      ? t('voiceLibrary.previewLanguageUnsupported', 'This model has no sample sentence in a language it speaks.')
      : undefined;

  // Synthesize the sample sentence with the selected voice so the user hears
  // what it actually sounds like. A `builtin:` id previews the PRESET in its
  // own language (spec §6.2) -- there is no reference clip behind a preset,
  // so a synthesis failure has nothing to fall back to and instead reports
  // voiceLibrary.previewFailed. A `custom:` id previews the CLONE in the
  // target language, falling back to replaying the reference clip (the
  // previous behaviour) on any synthesis failure -- deliberate, not a
  // consolation prize: replaying answers "did I record clearly?", synthesis
  // answers "does the clone sound like me". `signal` aborting (a newer
  // preview superseded this one, or the component unmounted) returns null
  // silently rather than falling back, mirroring "a superseded request
  // should never reach the network" from VoiceLibrarySection's own doc
  // comment -- though the actual sidecar call in flight cannot itself be
  // cancelled (PreviewTtsHandle.synthesize takes no signal), so this only
  // ever short-circuits around it, never stops it.
  const handlePreview = useCallback(async (id: string, signal?: AbortSignal) => {
    if (id.startsWith('builtin:')) {
      // Mirrors the clone branch's own early check below (after its await):
      // a superseded/unmounted request should never reach the network, even
      // though everything above this point is synchronous and the window it
      // closes is narrow -- keeping both branches symmetric here means a
      // reader never has to ask why one bails early and the other doesn't.
      if (signal?.aborted) return null;
      const name = id.slice('builtin:'.length);
      const voice = builtinVoices.find((v) => v.name === name);
      const sample = sampleFor(voice?.language);
      // No sentence in a language this model speaks: nothing to synthesize,
      // and no clip to fall back on -- a preset has no reference audio.
      if (!sample) return null;
      const cacheKey = previewCacheKey(`native:${ttsModelId}`, id, sample.language, PREVIEW_SPEED);
      const cached = getCachedPreview(cacheKey);
      if (cached) return signal?.aborted ? null : cached;
      // See synthInFlightRef's doc comment above: another row's synthesis is
      // still using the shared client, so don't start an overlapping one --
      // checked BEFORE creating a connection, so a request about to bail
      // here never pays for one.
      if (synthInFlightRef.current) return null;
      if (!previewTtsRef.current) previewTtsRef.current = createPreviewTts();
      synthInFlightRef.current = true;
      try {
        const result = await previewTtsRef.current.synthesize({
          modelId: ttsModelId,
          // The sidecar stores the language on the engine at init, so a
          // language change re-inits -- seconds, not milliseconds. The row's
          // spinner covers it.
          language: sample.language,
          text: sample.text,
          speed: PREVIEW_SPEED,
          voice: { kind: 'name', name },
          signal,
        });
        setCachedPreview(cacheKey, result);
        return signal?.aborted ? null : result;
      } catch {
        // An abort is the user's own doing (a newer preview, a closed
        // popover) and now actively cancels the sidecar, so the rejection it
        // can produce must not read as a failure. The clone branch below has
        // always made this distinction; this branch did not.
        if (signal?.aborted) return null;
        setCaptureError(t('voiceLibrary.previewFailed', 'Could not synthesize a preview for this voice.'));
        return null;
      } finally {
        synthInFlightRef.current = false;
      }
    }

    if (!store || !id.startsWith('custom:')) return null;
    const numId = Number(id.slice('custom:'.length));
    if (!Number.isFinite(numId)) return null;

    const payload = await store.resolveApply(numId);
    if (signal?.aborted) return null;
    const clip = payload && payload.kind === 'clip'
      ? { audio: payload.audio, sampleRate: payload.sampleRate }
      : null;
    if (!clip) return null;

    // previewUnavailableReason already disables the control in this case, so
    // this only guards against a stale render still invoking the callback.
    if (!previewSample) return clip;

    const cacheKey = previewCacheKey(`native:${ttsModelId}`, id, previewSample.language, PREVIEW_SPEED);
    const cached = getCachedPreview(cacheKey);
    if (cached) return signal?.aborted ? null : cached;

    // See synthInFlightRef's doc comment above: another row's synthesis is
    // still using the shared client, so don't start an overlapping one --
    // checked BEFORE creating a connection, so a request about to fall back
    // to the clip here never pays for one.
    if (synthInFlightRef.current) return signal?.aborted ? null : clip;

    if (!previewTtsRef.current) previewTtsRef.current = createPreviewTts();

    synthInFlightRef.current = true;
    try {
      const result = await previewTtsRef.current.synthesize({
        modelId: ttsModelId,
        language: previewSample.language,
        text: previewSample.text,
        speed: PREVIEW_SPEED,
        voice: { kind: 'clip', audio: clip.audio, sampleRate: clip.sampleRate, refText: payload?.transcript },
        signal,
      });
      // Cache a successful result even if THIS request was superseded
      // meanwhile: the user already waited and the sidecar already spent the
      // synthesis work, so throwing it away would cost the next click on
      // this same row a full re-synthesis for nothing. Only the RETURN is
      // conditioned on abort (so a superseded request never plays over a
      // newer one) -- caching is unconditional.
      setCachedPreview(cacheKey, result);
      if (signal?.aborted) return null;
      return result;
    } catch {
      if (signal?.aborted) return null;
      return clip;
    } finally {
      synthInFlightRef.current = false;
    }
  }, [store, previewSample, ttsModelId, builtinVoices, sampleFor, t]);

  const voices = useMemo<VoiceEntry[]>(() => {
    const { curated, rest } = curatedBuiltinVoices(targetLanguage, builtinVoices);
    const toBuiltin = (v: NativeVoiceInfo, isCurated: boolean): VoiceEntry => ({
      id: `builtin:${v.name}`,
      label: v.name,
      group: 'builtin',
      removable: false,
      // Presets audition in THEIR OWN language on the dedicated preview
      // connection (spec §6.2); the `builtin:` branch of handlePreview below
      // resolves the name against builtinVoices and synthesizes in that
      // voice's own language.
      previewable: true,
      meta: { curated: isCurated, unstable: v.unstable, language: v.language },
    });
    const builtinEntries = [
      ...curated.map((v) => toBuiltin(v, true)),
      ...rest.map((v) => toBuiltin(v, false)),
    ];
    // Models requiring an in-context-learning transcript (Task 10's
    // `transcriptRequired`) can only clone from clips that carry one — a clip
    // recorded/imported before the model required transcripts (or under a
    // different model) would otherwise silently fail to clone. Hide it from
    // the pickable list rather than let it fail at apply time. The predicate
    // is nativeCatalog's, shared with the pre-init gate and the selection
    // reconciliation, so "eligible" cannot mean two things.
    const eligible = eligibleCustomVoices(customVoices, capability.transcriptRequired);
    const customEntries: VoiceEntry[] = eligible.map((v) => ({
      id: `custom:${v.id}`,
      label: v.name,
      group: 'custom',
      removable: true,
    }));
    return [...builtinEntries, ...customEntries];
  }, [builtinVoices, customVoices, targetLanguage, capability.transcriptRequired]);

  if (capability.builtin === 'none' && capability.custom === 'none') return null;

  // Renderer-side mirror of the sidecar's R16 pre-check (tts_backend.py's
  // `_ensure_voice_ready`, over `catalog.VOICE_REQUIRED_FAMILIES`, read off the
  // wire as `voice.required`): a model that requires a clip — qwen3_tts,
  // omnivoice, index_tts2 — can't speak until at least one eligible clip
  // exists. Families that merely clone (MOSS, VoxCPM, Irodori) do not qualify,
  // even though their voice shape is identical. Same eligibility filter as the pickable list
  // above (transcriptRequired models don't count a clip with no transcript),
  // so this banner and the dropdown's actual contents never disagree.
  const eligibleCustom = eligibleCustomVoices(customVoices, capability.transcriptRequired);
  const eligibleCustomVoiceCount = eligibleCustom.length;
  const needsClipBeforeUse = requiresVoiceClip(capability) && eligibleCustomVoiceCount === 0;

  // Reconcile for display, through the SAME function the client applies at
  // session start (LocalNativeClient) — so the name on the picker is the voice
  // that will actually speak.
  //
  // This was `selected || defaultTtsVoice(...)`, a falsy check, which only
  // ever caught an EMPTY selection. `ttsVoice` is one global setting shared by
  // every TTS model, and switching models rewrites only
  // `selections[dir].tts.modelId` — so a non-empty selection belonging to the
  // previous model stayed truthy, sailed through, and reached VoicePicker's
  // `selected?.label ?? selectedId`, which printed it raw: `custom:21` after
  // moss -> supertonic, `builtin:F4` after supertonic -> moss.
  //
  // Deliberately does NOT write the setting back. The stored value stays as
  // the user left it, so switching back to the model it belongs to restores
  // their choice instead of having silently destroyed it.
  const selectedId = reconcileTtsVoice(
    selected,
    eligibleCustom.map((v) => v.id),
    targetLanguage,
    builtinVoices,
    capability.custom !== 'none',
    capability.builtin === 'named',
  );
  // Only widen the capability object when the model actually requires a
  // transcript — other models' store.capability objects (MOSS, Supertonic,
  // WASM local-inference) pass through unchanged so VoiceLibrarySection's
  // behavior for them stays byte-identical.
  const libraryCapability: VoiceLibraryCapability = capability.transcriptRequired
    ? { ...(store?.capability ?? DEFAULT_LIBRARY_CAPABILITY), transcriptRequired: true }
    : (store?.capability ?? DEFAULT_LIBRARY_CAPABILITY);

  return (
    <>
      <VoiceLibrarySection
        voices={voices}
        selectedId={selectedId}
        onSelect={onSelect}
        onImport={handleImport}
        onRecord={store?.onRecord ? handleRecord : undefined}
        onRename={handleRename}
        onDelete={handleDelete}
        onPreview={handlePreview}
        previewUnavailableReason={previewUnavailableReason}
        capability={libraryCapability}
        isSessionActive={isSessionActive}
      />
      {needsClipBeforeUse && (
        <div className="voice-capture-error" role="alert">
          {t('voiceLibrary.cloneVoiceRequired', 'This voice needs a clip before it can speak — open the voice list and add one.')}
        </div>
      )}
      {captureError && (
        <div className="voice-capture-error" role="alert">{captureError}</div>
      )}
    </>
  );
};

export default NativeVoiceSection;
