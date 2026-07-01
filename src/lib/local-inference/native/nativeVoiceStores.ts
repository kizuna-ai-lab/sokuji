/**
 * NativeVoiceStore — uniform abstraction over the two native custom-voice
 * persistence backends so the voice UI can drive either one generically:
 *   - 'clip'  (nativeVoiceStorage): user-recorded/imported reference audio,
 *     applied as a zero-shot voice-cloning prompt (e.g. MOSS-TTS-Nano).
 *   - 'style' (voiceStorage): imported Supertonic style cards (JSON blobs of
 *     precomputed style vectors), applied directly without cloning.
 *
 * `validateVoiceClip` / `downmixToMono` used to live in NativeVoiceSection.tsx;
 * they moved here so both the clip store and any future caller share one
 * implementation. NativeVoiceSection.tsx re-exports `validateVoiceClip` for
 * its existing test/consumers.
 */

import type { VoiceLibraryCapability } from '../../../components/Settings/sections/VoiceLibrarySection';
import {
  listNativeVoices, addNativeVoice, renameNativeVoice, deleteNativeVoice, getNativeVoice,
} from '../nativeVoiceStorage';
import {
  listVoices, addVoice, renameVoice, deleteVoice, getVoice,
  type StoredVoice,
} from '../voiceStorage';
import type { VoiceCustom } from './nativeCatalog';

export interface NativeCustomVoice { id: number; name: string; }

export type VoiceApplyPayload =
  | { kind: 'clip'; audio: Float32Array; sampleRate: number }
  | { kind: 'style'; styleTtl: { dims: number[]; data: number[] }; styleDp: { dims: number[]; data: number[] } };

export interface NativeVoiceStore {
  kind: 'clip' | 'style';
  capability: VoiceLibraryCapability;
  list(): Promise<NativeCustomVoice[]>;
  onImport(file: File): Promise<void>;
  onRecord?(clip: Float32Array, sampleRate: number): Promise<void>;
  rename(id: number, name: string): Promise<void>;
  delete(id: number): Promise<void>;
  resolveApply(id: number): Promise<VoiceApplyPayload | null>;
}

/* ------------------------------------------------------------------------ */
/* Clip validation — moved from NativeVoiceSection.tsx                       */
/* ------------------------------------------------------------------------ */

/** Reference-clip bounds: too short carries no timbre, too long wastes storage
 *  and slows cloning. Mirrors typical zero-shot voice-cloning guidance (~3–20s).
 *  Exported so callers can interpolate these into a user-facing message. */
export const MIN_CLIP_SECONDS = 3;
export const MAX_CLIP_SECONDS = 20;
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
export function downmixToMono(buffer: AudioBuffer): Float32Array {
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

/** Thrown by the clip store's onImport/onRecord when the captured clip fails
 *  `validateVoiceClip`, so the UI can look up a message by `code`. */
export class VoiceCaptureError extends Error {
  constructor(public readonly code: ClipValidationError, message: string) {
    super(message);
    this.name = 'VoiceCaptureError';
  }
}

/* ------------------------------------------------------------------------ */
/* Clip store — wraps nativeVoiceStorage                                     */
/* ------------------------------------------------------------------------ */

class ClipVoiceStore implements NativeVoiceStore {
  readonly kind = 'clip' as const;
  readonly capability: VoiceLibraryCapability = {
    importModes: ['record', 'upload'],
    accept: 'audio/*',
    curation: false,
    presentation: 'dropdown',
  };

  async list(): Promise<NativeCustomVoice[]> {
    const voices = await listNativeVoices();
    return voices.map((v) => ({ id: v.id, name: v.name }));
  }

  async onImport(file: File): Promise<void> {
    const arrayBuffer = await file.arrayBuffer();
    const ctx = new AudioContext();
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(arrayBuffer);
    } finally {
      void ctx.close();
    }
    const mono = downmixToMono(buffer);
    const name = file.name.replace(/\.[^./\\]+$/, '') || 'Imported voice';
    await this.storeClip(name, mono, buffer.sampleRate);
  }

  async onRecord(clip: Float32Array, sampleRate: number): Promise<void> {
    await this.storeClip('Recorded voice', clip, sampleRate);
  }

  private async storeClip(name: string, clip: Float32Array, sampleRate: number): Promise<void> {
    const reason = validateVoiceClip(clip, sampleRate);
    if (reason) {
      throw new VoiceCaptureError(reason, `Voice clip failed validation: ${reason}`);
    }
    await addNativeVoice(name, clip, sampleRate);
  }

  async rename(id: number, name: string): Promise<void> {
    await renameNativeVoice(id, name);
  }

  async delete(id: number): Promise<void> {
    await deleteNativeVoice(id);
  }

  async resolveApply(id: number): Promise<VoiceApplyPayload | null> {
    const stored = await getNativeVoice(id);
    if (!stored) return null;
    return { kind: 'clip', audio: new Float32Array(stored.audio), sampleRate: stored.sampleRate };
  }
}

/* ------------------------------------------------------------------------ */
/* Style store — wraps voiceStorage                                          */
/* ------------------------------------------------------------------------ */

class StyleVoiceStore implements NativeVoiceStore {
  readonly kind = 'style' as const;
  readonly capability: VoiceLibraryCapability = {
    importModes: ['upload'],
    curation: false,
    presentation: 'dropdown',
  };

  constructor(private readonly modelId: string) {}

  async list(): Promise<NativeCustomVoice[]> {
    const voices = await listVoices(this.modelId as StoredVoice['engine']);
    return voices.map((v) => ({ id: v.id, name: v.name }));
  }

  async onImport(file: File): Promise<void> {
    const name = file.name.replace(/\.[^./\\]+$/, '') || 'Imported voice';
    // addVoice throws voiceStorage.VoiceImportError on validation failure;
    // let it propagate so the UI can surface it by `code`.
    await addVoice(this.modelId as StoredVoice['engine'], name, file);
  }

  async rename(id: number, name: string): Promise<void> {
    await renameVoice(id, name);
  }

  async delete(id: number): Promise<void> {
    await deleteVoice(id);
  }

  async resolveApply(id: number): Promise<VoiceApplyPayload | null> {
    const stored = await getVoice(id);
    if (!stored) return null;
    const text = await readBlobAsText(stored.jsonData);
    const parsed = JSON.parse(text) as {
      style_ttl: { dims: number[]; data: number[] };
      style_dp: { dims: number[]; data: number[] };
    };
    return { kind: 'style', styleTtl: parsed.style_ttl, styleDp: parsed.style_dp };
  }
}

/**
 * Read a Blob as text, compatible with both browser and jsdom environments.
 * jsdom's Blob may not implement `text()`; fall back to FileReader.
 */
function readBlobAsText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') {
    return blob.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/* ------------------------------------------------------------------------ */

/** Returns the store matching a model's `custom` voice capability (from
 *  `nativeCatalog`), or `null` when the model has no custom-voice support. */
export function voiceStoreFor(custom: VoiceCustom, modelId: string): NativeVoiceStore | null {
  switch (custom) {
    case 'clip':
      return new ClipVoiceStore();
    case 'style':
      return new StyleVoiceStore(modelId);
    case 'none':
    default:
      return null;
  }
}
