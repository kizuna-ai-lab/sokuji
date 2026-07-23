import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceLibrarySection, { type VoiceEntry } from './VoiceLibrarySection';
import type { VoiceLibraryCapability } from '../../../types/VoiceLibrary';
import {
  curatedBuiltinVoices,
  defaultTtsVoice,
  sidFromTtsVoice,
  ttsVoiceForSid,
  type VoiceCapability,
} from '../../../lib/local-inference/native/nativeCatalog';
import type { NativeVoiceInfo } from '../../../lib/local-inference/native/nativeProtocol';
import {
  validateVoiceClip, MIN_CLIP_SECONDS, MAX_CLIP_SECONDS, VoiceCaptureError,
  type ClipValidationError, type NativeCustomVoice, type NativeVoiceStore,
} from '../../../lib/local-inference/native/nativeVoiceStores';
import { VoiceImportError } from '../../../lib/local-inference/voiceStorage';

// validateVoiceClip now lives in nativeVoiceStores.ts (shared with the
// NativeVoiceStore abstraction). Re-exported here so this file's own test
// keeps working.
export { validateVoiceClip };
export type { ClipValidationError };

/**
 * Native (Electron sidecar) adapter over the generalized VoiceLibrarySection.
 * Switches on the selected TTS model's `VoiceCapability` (Task 10):
 *   - `builtin === 'range'` → the classic speaker-id slider (`sid:<n>`).
 *   - otherwise            → VoiceLibrarySection composed from the sidecar's
 *     built-in voice list (`builtin:<Name>` entries, curated-first) plus the
 *     injected `store`'s custom voices (`custom:<id>` entries, removable).
 *   - `{builtin:'none', custom:'none'}` → nothing to render.
 *
 * The `store` (from `voiceStoreFor`, Task 11) abstracts over the two custom
 * -voice backends — clip cloning (MOSS) vs style import (Supertonic-shaped
 * native models) — so this component no longer needs to know which one it's
 * talking to. It owns loading/refreshing the custom list locally (via
 * `store.list()`) and calls the parent's `onCustomChanged` after a
 * successful mutation so any parent-side cache stays in sync.
 *
 * Capture errors (`VoiceCaptureError` from the clip store, `VoiceImportError`
 * from the style store) are caught here and surfaced inline; nothing is
 * written to the voice list when validation fails.
 */
export interface NativeVoiceSectionProps {
  /** The selected TTS model's voice capability (built-in shape + custom-voice kind). */
  capability: VoiceCapability;
  /** Total speaker count for a 'range' model (the slider runs 0 .. numSpeakers-1). */
  numSpeakers?: number;
  /** Built-in voice descriptors from the sidecar (empty when the model isn't downloaded). */
  builtinVoices: NativeVoiceInfo[];
  /** Custom-voice backend for this model; null when `capability.custom === 'none'`. */
  store: NativeVoiceStore | null;
  /** Current settings.ttsVoice (opaque id); empty → default voice for the language. */
  selected: string;
  /** Target language, drives curation ordering + the default voice. */
  targetLanguage: string;
  /** Disables voice selection while a session is active. */
  isSessionActive?: boolean;
  /** Write the picked voice id to settings.ttsVoice. */
  onSelect: (id: string) => void;
  /** Notified after a custom voice is imported/recorded/renamed/deleted. */
  onCustomChanged: () => void;
}

const DEFAULT_LIBRARY_CAPABILITY: VoiceLibraryCapability = {
  importModes: [], curation: false, presentation: 'dropdown',
};

const NativeVoiceSection: React.FC<NativeVoiceSectionProps> = ({
  capability,
  numSpeakers,
  builtinVoices,
  store,
  selected,
  targetLanguage,
  isSessionActive = false,
  onSelect,
  onCustomChanged,
}) => {
  const { t } = useTranslation();
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [customVoices, setCustomVoices] = useState<NativeCustomVoice[]>([]);

  const reloadCustomVoices = useCallback(() => {
    if (!store) { setCustomVoices([]); return; }
    store.list().then(setCustomVoices).catch(() => setCustomVoices([]));
  }, [store]);

  useEffect(() => {
    reloadCustomVoices();
  }, [reloadCustomVoices]);

  const clipErrorMessage = useCallback((reason: ClipValidationError): string => {
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
  }, [t]);

  // Turn a capture failure into a user-facing message: clip validation errors
  // (record/upload on the clip store) map by code; style-import failures
  // (VoiceImportError) show their own message; anything else falls back to a
  // generic "couldn't read that file" notice.
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
      setCaptureError(captureErrorMessage(err));
      // Rethrow so VoiceLibrarySection's own try/catch sees the failure and
      // leaves the transcript field filled in (it only clears it after an
      // awaited onImport call resolves — see its JSDoc).
      throw err;
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
      setCaptureError(captureErrorMessage(err));
      // Same rethrow rationale as handleImport above: keep the transcript
      // field populated on a failed recording rather than wiping it.
      throw err;
    }
  }, [store, reloadCustomVoices, onCustomChanged, captureErrorMessage]);

  const handleRename = useCallback(async (id: string, name: string) => {
    if (!store || !id.startsWith('custom:')) return;
    const numId = Number(id.slice('custom:'.length));
    if (!Number.isFinite(numId)) return;
    await store.rename(numId, name);
    reloadCustomVoices();
    onCustomChanged();
  }, [store, reloadCustomVoices, onCustomChanged]);

  const handleDelete = useCallback(async (id: string) => {
    if (!store || !id.startsWith('custom:')) return;
    const numId = Number(id.slice('custom:'.length));
    if (!Number.isFinite(numId)) return;
    await store.delete(numId);
    reloadCustomVoices();
    onCustomChanged();
  }, [store, reloadCustomVoices, onCustomChanged]);

  // Fetch a custom clip's audio so the user can play it back and check clarity.
  const handlePreview = useCallback(async (id: string) => {
    if (!store || !id.startsWith('custom:')) return null;
    const numId = Number(id.slice('custom:'.length));
    if (!Number.isFinite(numId)) return null;
    const payload = await store.resolveApply(numId);
    return payload && payload.kind === 'clip'
      ? { audio: payload.audio, sampleRate: payload.sampleRate }
      : null;
  }, [store]);

  const voices = useMemo<VoiceEntry[]>(() => {
    const { curated, rest } = curatedBuiltinVoices(targetLanguage, builtinVoices);
    const toBuiltin = (v: NativeVoiceInfo, isCurated: boolean): VoiceEntry => ({
      id: `builtin:${v.name}`,
      label: v.name,
      group: 'builtin',
      removable: false,
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
    // the pickable list rather than let it fail at apply time.
    const eligibleCustomVoices = capability.transcriptRequired
      ? customVoices.filter((v) => v.hasTranscript)
      : customVoices;
    const customEntries: VoiceEntry[] = eligibleCustomVoices.map((v) => ({
      id: `custom:${v.id}`,
      label: v.name,
      group: 'custom',
      removable: true,
    }));
    return [...builtinEntries, ...customEntries];
  }, [builtinVoices, customVoices, targetLanguage, capability.transcriptRequired]);

  if (capability.builtin === 'none' && capability.custom === 'none') return null;

  if (capability.builtin === 'range') {
    const max = Math.max(1, (numSpeakers ?? 1) - 1);
    const sid = Math.min(sidFromTtsVoice(selected), max);
    return (
      <div className="setting-item">
        <div className="setting-label">
          <span>{t('settings.ttsSpeakerId', 'Speaker ID')}</span>
          <span className="setting-value">{sid}</span>
        </div>
        <input type="range" min="0" max={max} step="1" value={sid}
          onChange={(e) => onSelect(ttsVoiceForSid(parseInt(e.target.value, 10)))}
          className="slider" disabled={isSessionActive} />
      </div>
    );
  }

  // Reconcile for display: an empty choice shows the language default as selected.
  const selectedId = selected || defaultTtsVoice(targetLanguage, builtinVoices);
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
        capability={libraryCapability}
        isSessionActive={isSessionActive}
      />
      {captureError && (
        <div className="voice-capture-error" role="alert">{captureError}</div>
      )}
    </>
  );
};

export default NativeVoiceSection;
