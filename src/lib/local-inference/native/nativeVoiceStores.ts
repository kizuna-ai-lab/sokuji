/**
 * NativeVoiceStore — uniform abstraction over the native custom-voice
 * persistence backend so the voice UI can drive it generically:
 *   - 'clip'  (nativeVoiceStorage): user-recorded/imported reference audio,
 *     applied as a zero-shot voice-cloning prompt (e.g. MOSS-TTS-Nano).
 *
 * The old 'style' backend (voiceStorage-imported Supertonic style cards,
 * JSON blobs of precomputed style vectors) died with the ONNX Supertonic
 * backend (Task 5's catalog rewire onto native_tts, which has no
 * set_style_voice equivalent) and the renderer's setStyleVoice sender
 * (Task 6). `voiceStorage.ts` itself is unaffected — the WASM/browser lane's
 * own Supertonic implementation still uses it directly.
 *
 * `validateVoiceClip` / `downmixToMono` used to live in NativeVoiceSection.tsx;
 * they moved here so both the clip store and any future caller share one
 * implementation. NativeVoiceSection.tsx re-exports `validateVoiceClip` for
 * its existing test/consumers.
 */

import type { VoiceLibraryCapability } from '../../../types/VoiceLibrary';
import {
  listNativeVoices, addNativeVoice, renameNativeVoice, deleteNativeVoice, getNativeVoice,
} from '../nativeVoiceStorage';
import type { VoiceCustom } from './nativeCatalog';

export interface NativeCustomVoice {
  id: number;
  name: string;
  /** Whether this voice carries a reference transcript (the clip store's
   *  clone-with-transcript models set it; clip-only models leave it false). */
  hasTranscript?: boolean;
}

export interface VoiceApplyPayload {
  kind: 'clip'; audio: Float32Array; sampleRate: number; transcript?: string;
}

export interface NativeVoiceStore {
  kind: 'clip';
  capability: VoiceLibraryCapability;
  list(): Promise<NativeCustomVoice[]>;
  onImport(file: File, transcript?: string): Promise<void>;
  onRecord?(clip: Float32Array, sampleRate: number, transcript?: string): Promise<void>;
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

/** Per-model reference-clip limits (seconds). Cloning models tolerate very
 *  different reference lengths, so the limit is data here and travels to the
 *  UI via `VoiceLibraryCapability.maxClipSeconds` (recording countdown +
 *  auto-stop, import rejection). Models not listed use the defaults above. */
const MODEL_CLIP_LIMITS: Record<string, { min?: number; max?: number }> = {
  // OmniVoice's non-AR decode degrades past ~8s of reference (garbled words,
  // then collapse; seen on the ONNX-era backend, not re-measured on audio.cpp).
  // Nothing downstream trims a longer clip, so the store caps it.
  'omnivoice-0.6b': { max: 8 },
  // audio.cpp caps a VibeVoice voice prompt at 10s on every backend but CUDA/HIP
  // (src/models/vibevoice/session.cpp:25-26); Sokuji hands it the clip in memory, which skips
  // that cap, so the store applies it.
  'vibevoice-1.5b': { max: 10 },
  // Both Irodori v4 GGUFs embed the same v4.1-Small model card, which recommends about 30s or
  // more of clean reference speech for cloning and evaluated on 30.12-40.08s references;
  // audio.cpp's irodori sources set no ceiling, so the window is 40s and the default 20s
  // would stop a recording short of what the card asks for.
  'irodori-tts-v4.1-anime': { max: 40 },
  'irodori-tts-v4-small': { max: 40 },
  // audio8_tts sets no reference ceiling (community_models/audio8_tts/session.cpp); its vendor
  // card only warns that very long clips reduce stability, so the default ceiling stands.
  'audio8-tts-0.6b': { max: 20 },
  // GLM-TTS clones from 3–10 seconds of prompt audio (zai-org/GLM-TTS model card).
  'glm-tts': { max: 10 },
  // OuteTTS refuses a reference over 20 s (community_models/outetts/dac.cpp:343-347), and every
  // second of it comes out of the ~42 s generation window (OuteAI/Llama-OuteTTS-1.0-1B card).
  'outetts-1.0-1b': { max: 15 },
  // Echo-TTS trims a reference to 15 s by default (community_models/echo_tts/session.cpp,
  // kDefaultReferenceMaxSamples), so a longer recording only costs storage.
  'echo-tts': { max: 15 },
  // Kitten TTS 2 accepts 1–30 s of reference (community_models/kitten_tts2/session.cpp); the
  // default 3–20 s window sits inside it.
  'kitten-tts2': { max: 20 },
  // VoiceTut is an OmniVoice fine-tune on the same non-AR decoder (omnivoice family).
  'voicetut-tts': { max: 8 },
  // MioTTS sets no reference ceiling (models/miotts/session.cpp); the default window stands.
  'miotts-1.7b': { max: 20 },
};

/** Peak amplitude below this is treated as silence (a muted mic / empty file). */
const SILENCE_PEAK_THRESHOLD = 0.01;

export type ClipValidationError = 'too_short' | 'too_long' | 'silent';

/** Pure validation for a captured/decoded reference clip. Returns the failure
 *  reason or null when the clip is usable. Exported for direct unit testing.
 *  Limits default to the global bounds; clip stores pass their model's. */
export function validateVoiceClip(
  clip: Float32Array, sampleRate: number,
  maxSeconds: number = MAX_CLIP_SECONDS, minSeconds: number = MIN_CLIP_SECONDS,
): ClipValidationError | null {
  const seconds = sampleRate > 0 ? clip.length / sampleRate : 0;
  if (seconds < minSeconds) return 'too_short';
  if (seconds > maxSeconds) return 'too_long';
  // Silence = no real signal. Use PEAK amplitude, not mean-abs over the whole
  // clip: a genuine but QUIET recording (a low-gain phone / web recorder peaks
  // ~0.06 vs ~0.5 for normal speech) or one with long pauses has a tiny mean-abs
  // yet is clearly not silent — mean-abs wrongly rejected such clips as "No
  // voice detected". Loudness is fixed by normalizePeak on store (+ the sidecar's
  // prepare_reference); validation only needs to reject TRUE silence.
  let peak = 0;
  for (let i = 0; i < clip.length; i++) {
    const a = Math.abs(clip[i]);
    if (a > peak) peak = a;
  }
  if (peak < SILENCE_PEAK_THRESHOLD) return 'silent';
  return null;
}

/** Peak-normalize a clip to `target` so a quiet recording is stored, previewed,
 *  and cloned at a usable level. No-op for a (near-)silent clip. */
export function normalizePeak(clip: Float32Array, target = 0.95): Float32Array {
  let peak = 0;
  for (let i = 0; i < clip.length; i++) {
    const a = Math.abs(clip[i]);
    if (a > peak) peak = a;
  }
  if (peak < 1e-5) return clip;
  const gain = target / peak;
  const out = new Float32Array(clip.length);
  for (let i = 0; i < clip.length; i++) out[i] = clip[i] * gain;
  return out;
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
  readonly capability: VoiceLibraryCapability;

  constructor(modelId: string) {
    const limits = MODEL_CLIP_LIMITS[modelId] ?? {};
    this.capability = {
      importModes: ['record', 'upload'],
      accept: 'audio/*',
      maxClipSeconds: limits.max ?? MAX_CLIP_SECONDS,
      minClipSeconds: limits.min ?? MIN_CLIP_SECONDS,
    };
  }

  async list(): Promise<NativeCustomVoice[]> {
    const voices = await listNativeVoices();
    return voices.map((v) => ({ id: v.id, name: v.name, hasTranscript: !!v.transcript }));
  }

  async onImport(file: File, transcript?: string): Promise<void> {
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
    await this.storeClip(name, mono, buffer.sampleRate, transcript);
  }

  async onRecord(clip: Float32Array, sampleRate: number, transcript?: string): Promise<void> {
    await this.storeClip('Recorded voice', clip, sampleRate, transcript);
  }

  private async storeClip(name: string, clip: Float32Array, sampleRate: number, transcript?: string): Promise<void> {
    const reason = validateVoiceClip(
      clip, sampleRate,
      this.capability.maxClipSeconds ?? MAX_CLIP_SECONDS,
      this.capability.minClipSeconds ?? MIN_CLIP_SECONDS);
    if (reason) {
      throw new VoiceCaptureError(reason, `Voice clip failed validation: ${reason}`);
    }
    // Store at a usable loudness so a quiet recording isn't near-inaudible on
    // preview and clones well (the sidecar re-normalizes too, but this keeps the
    // stored + previewed clip correct).
    await addNativeVoice(name, normalizePeak(clip), sampleRate, transcript);
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
    return {
      kind: 'clip', audio: new Float32Array(stored.audio), sampleRate: stored.sampleRate, transcript: stored.transcript,
    };
  }
}

/* ------------------------------------------------------------------------ */

/** Returns the store matching a model's `custom` voice capability (from
 *  `nativeCatalog`), or `null` when the model has no custom-voice support
 *  (including a stale/unrecognized value — the old 'style' capability died
 *  server-side and has no store implementation left to construct). */
export function voiceStoreFor(custom: VoiceCustom, modelId: string): NativeVoiceStore | null {
  switch (custom) {
    case 'clip':
      return new ClipVoiceStore(modelId);
    case 'none':
    default:
      return null;
  }
}
