import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceLibrarySection, { type VoiceEntry } from './VoiceLibrarySection';
import {
  curatedBuiltinVoices,
  defaultTtsVoice,
  sidFromTtsVoice,
  ttsVoiceForSid,
  type VoiceShape,
} from '../../../lib/local-inference/native/nativeCatalog';
import type { NativeVoiceInfo } from '../../../lib/local-inference/native/nativeProtocol';
import { addNativeVoice, type StoredNativeVoice } from '../../../lib/local-inference/nativeVoiceStorage';

/** Reference-clip bounds: too short carries no timbre, too long wastes storage
 *  and slows cloning. Mirrors typical zero-shot voice-cloning guidance (~3–20s). */
const MIN_CLIP_SECONDS = 3;
const MAX_CLIP_SECONDS = 20;
/** Mean absolute amplitude below this is treated as silence (a muted mic / empty file). */
const SILENCE_RMS_THRESHOLD = 0.005;

export type ClipValidationError = 'too_short' | 'too_long' | 'silent';

/** Pure validation for a captured/decoded reference clip. Returns the failure
 *  reason or null when the clip is usable. Exported for direct unit testing. */
export function validateVoiceClip(clip: Float32Array, sampleRate: number): ClipValidationError | null {
  const seconds = sampleRate > 0 ? clip.length / sampleRate : 0;
  if (seconds < MIN_CLIP_SECONDS) return 'too_short';
  if (seconds > MAX_CLIP_SECONDS) return 'too_long';
  let sum = 0;
  for (let i = 0; i < clip.length; i++) sum += Math.abs(clip[i]);
  const meanAbs = clip.length > 0 ? sum / clip.length : 0;
  if (meanAbs < SILENCE_RMS_THRESHOLD) return 'silent';
  return null;
}

/** Downmix an AudioBuffer to a single mono Float32Array (channel average). */
function downmixToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels <= 1) return buffer.getChannelData(0).slice();
  const length = buffer.length;
  const out = new Float32Array(length);
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) out[i] += data[i];
  }
  for (let i = 0; i < length; i++) out[i] /= channels;
  return out;
}

/**
 * Native (Electron sidecar) adapter over the generalized VoiceLibrarySection.
 * Uses the same dropdown presentation as Supertonic: built-in voices (ordered
 * curated-first; ids `builtin:<Name>`) fill the "Presets" optgroup and the user's
 * recorded/imported custom voices (ids `custom:<id>`) fill "My Voices", with a
 * manage list (rename/delete). The chosen opaque id is written back as `ttsVoice`.
 * The only difference from Supertonic is import: record OR upload (audio), vs
 * Supertonic's upload-only voice file.
 *
 * Built-in NAMES come from the sidecar (`list_tts_voices`, fetched by the
 * parent); `[]` when the model isn't downloaded yet, in which case only the
 * (empty) presets group renders and the parent surfaces a download hint.
 *
 * Capture lives here: VoiceLibrarySection records the mic / picks the file and
 * hands us a Float32 clip (record) or a File (upload). We validate (record) or
 * decode + downmix (upload), persist via `addNativeVoice`, then ask the parent
 * to reload the custom list via `onCaptured`. Validation failures are surfaced
 * inline and never write to storage.
 */
export interface NativeVoiceSectionProps {
  /** Built-in voice descriptors from the sidecar (empty when the model isn't downloaded). */
  builtinVoices: NativeVoiceInfo[];
  /** User-owned custom voices from nativeVoiceStorage. */
  customVoices: StoredNativeVoice[];
  /** Current settings.ttsVoice (opaque id); empty → default voice for the language. */
  selected: string;
  /** Target language, drives curation ordering + the default voice. */
  targetLanguage: string;
  /** Disables voice selection while a session is active. */
  isSessionActive?: boolean;
  /** Voice control shape driven by the selected TTS model's capability. Defaults to 'list'. */
  shape?: VoiceShape;
  /** Total speaker count for a 'range' model (the slider runs 0 .. numSpeakers-1). */
  numSpeakers?: number;
  /** Write the picked voice id to settings.ttsVoice. */
  onSelect: (id: string) => void;
  /** Reload the custom list after a successful capture (record/upload). */
  onCaptured: () => void;
  /** Forwarded rename of a custom voice (id is the opaque `custom:<id>`). */
  onRename: (id: string, name: string) => Promise<void>;
  /** Forwarded delete of a custom voice (id is the opaque `custom:<id>`). */
  onDelete: (id: string) => Promise<void>;
}

const NativeVoiceSection: React.FC<NativeVoiceSectionProps> = ({
  builtinVoices,
  customVoices,
  selected,
  targetLanguage,
  isSessionActive = false,
  shape = 'list',
  numSpeakers,
  onSelect,
  onCaptured,
  onRename,
  onDelete,
}) => {
  const { t } = useTranslation();
  const [captureError, setCaptureError] = useState<string | null>(null);

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
    const customEntries: VoiceEntry[] = customVoices.map((v) => ({
      id: `custom:${v.id}`,
      label: v.name,
      group: 'custom',
      removable: true,
    }));
    return [...builtinEntries, ...customEntries];
  }, [builtinVoices, customVoices, targetLanguage]);

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

  // Persist a validated clip and refresh the parent list. Returns false (and
  // surfaces a message) when validation fails so nothing is stored.
  const storeClip = useCallback(async (name: string, clip: Float32Array, sampleRate: number): Promise<boolean> => {
    const reason = validateVoiceClip(clip, sampleRate);
    if (reason) {
      setCaptureError(clipErrorMessage(reason));
      return false;
    }
    await addNativeVoice(name, clip, sampleRate);
    setCaptureError(null);
    onCaptured();
    return true;
  }, [clipErrorMessage, onCaptured]);

  const handleRecord = useCallback(async (clip: Float32Array, sampleRate: number) => {
    setCaptureError(null);
    await storeClip(t('voiceLibrary.recordedVoiceName', 'Recorded voice'), clip, sampleRate);
  }, [storeClip, t]);

  const handleImport = useCallback(async (file: File) => {
    setCaptureError(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new AudioContext();
      let buffer: AudioBuffer;
      try {
        buffer = await ctx.decodeAudioData(arrayBuffer);
      } finally {
        void ctx.close();
      }
      const mono = downmixToMono(buffer);
      const name = file.name.replace(/\.[^./\\]+$/, '') || t('voiceLibrary.importedVoiceName', 'Imported voice');
      await storeClip(name, mono, buffer.sampleRate);
    } catch {
      setCaptureError(t('voiceLibrary.decodeFailed', "Could not read that audio file — try a WAV, MP3, or other common format."));
    }
  }, [storeClip, t]);

  if (shape === 'none') return null;

  if (shape === 'range') {
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
  // shape === 'list' falls through to the VoiceLibrarySection dropdown below.

  // Reconcile for display: an empty choice shows the language default as selected.
  const selectedId = selected || defaultTtsVoice(targetLanguage, builtinVoices);

  return (
    <>
      <VoiceLibrarySection
        voices={voices}
        selectedId={selectedId}
        onSelect={onSelect}
        onImport={handleImport}
        onRecord={handleRecord}
        onRename={onRename}
        onDelete={onDelete}
        capability={{ importModes: ['record', 'upload'], curation: false, presentation: 'dropdown', accept: 'audio/*' }}
        isSessionActive={isSessionActive}
      />
      {captureError && (
        <div className="voice-capture-error" role="alert">{captureError}</div>
      )}
    </>
  );
};

export default NativeVoiceSection;
