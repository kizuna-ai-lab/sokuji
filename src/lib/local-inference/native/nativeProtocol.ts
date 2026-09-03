// WS message contract between the renderer and the python sidecar (TTS, translation, ASR, model management, hardware info).
export interface ReadyMsg {
  type: 'ready'; id: number; sampleRate?: number; loadTimeMs: number;   // sampleRate only on audio (ASR/TTS) ready; translate_init omits it
  backend?: string; device?: string; computeType?: string; rtf?: number; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string;
  streaming?: boolean; clones?: boolean;
  family?: string;   // native_tts only: the resolved card's family (moss_tts_nano | qwen3_tts | omnivoice | pocket_tts | supertonic | voxcpm1 | voxcpm2 | irodori_tts | index_tts2)
}
export interface NativeTier { tier: string; backend: string; available: boolean; }
/** Non-standard license terms on a model card, as catalog.license_dict emits them.
 *  `requiresConsent` — not `nonCommercial` — is what raises the download gate: a
 *  license can need acknowledging while still permitting commercial use (IndexTTS
 *  2.5's bilibili Model Use License allows it below a MAU/revenue ceiling), and
 *  labelling that "non-commercial" in the modal would be untrue. `nonCommercial`
 *  only picks which wording the modal shows. */
export interface NativeModelLicense {
  spdx: string; name: string; url: string;
  nonCommercial: boolean;
  /** Optional so a producer that omits it cannot silently drop an existing
   *  card's gate: every consumer must treat `undefined` as "gate it" (test
   *  `!== false`), which is also what the Python side's default True emits. */
  requiresConsent?: boolean;
  sourceRepo: string; attribution: string;
}
export interface NativeModelInfo {
  id: string; name: string; languages: string[]; recommended: boolean; tiers: NativeTier[];
  order: number; repo: string; kind: 'asr' | 'translate' | 'tts';
  clones?: boolean; streaming?: boolean;   // tts only
  /** tts only; native_tts has no style-vector custom voice equivalent.
   *  `required` (catalog.VOICE_REQUIRED_FAMILIES) is its OWN axis, not a shape
   *  inference: moss_tts_nano, voxcpm1, voxcpm2 and irodori_tts all report
   *  builtin 'none' + custom 'clip' and still speak with nothing set, while
   *  qwen3_tts/omnivoice/index_tts2 report the identical shape and cannot.
   *  Optional here only because a sidecar older than 2026-09-03 does not send
   *  it — absent means "cannot say", not "false" (see requiresVoiceClip). */
  voice?: { builtin: 'none' | 'named'; custom: 'none' | 'clip'; required?: boolean; transcriptRequired?: boolean };
  license?: NativeModelLicense;  // non-commercial / restricted models only
  sizeBytes?: number;   // total download size; 0/absent = unknown
  variantIds?: string[];   // quant variants (default first), >1 → show the picker
  /** Precomputed machine-aware quant ladder (quality-desc): the sidecar owns
   *  supported (fits this machine) + recommended (stable download pick). */
  variants?: { id: string; sizeBytes: number; needBytes?: number; repo?: string;
               supported: boolean; recommended: boolean }[];
  /** Stable budget basis (primary device total memory) the supported flags
   *  were computed against — feeds the localized "this machine has X" reason. */
  deviceMemBytes?: number | null;
}
/** A built-in TTS voice as the renderer consumes it. NOT a wire shape: the
 *  ggml-only sidecar publishes preset NAMES only (spec 2026-08-30 §5.5 —
 *  audio.cpp's sk_tts_presets carries no language/curation metadata), and
 *  NativeModelClient.listTtsVoices lifts each name into one of these with every
 *  flag false. The flags survive so a renderer-side curation table can fill
 *  them in later without touching the consumers (curatedBuiltinVoices,
 *  defaultTtsVoice, reconcileTtsVoice), which all read `.name`. */
export interface NativeVoiceInfo {
  name: string; language?: string; curated: boolean; unstable: boolean; default: boolean;
}
export interface HardwareInfoResultMsg {
  type: 'hardware_info_result'; id: number;
  os: string; arch: string; cpuCores: number;
  gpus: { vendor: string; name: string; vramMb: number }[];
  backendsInstalled: string[]; accelAvailable: boolean;
  // sokuji_native identity, reported once hardware_info succeeds against a loaded native runtime.
  nativeVersion?: string | null;
  engineVersions?: Record<string, string> | null;
  lane?: string | null;
  preferredDevice?: { kind: string; name: string; description: string } | null;
}
export interface ModelsCatalogResultMsg {
  type: 'models_catalog_result'; id: number; models: NativeModelInfo[];
}
export interface VariantInfo {
  id: string;
  computeType: string;
  repo: string;
  sizeBytes: number;
  supported: boolean;
  reason: string;
}
export interface ListVariantsResultMsg {
  type: 'list_variants_result'; id: number; variants: VariantInfo[]; recommended: string;
}
export interface OkMsg { type: 'ok'; id: number; }
export interface TtsGenerateResultMsg { type: 'tts_generate_result'; id: number; sampleRate: number; generationTimeMs: number; samples: number; }
export interface ErrorMsg { type: 'error'; id?: number; model?: string; message: string; }
export interface TranslateResultMsg { type: 'translate_result'; id: number; sourceText: string; translatedText: string; inferenceTimeMs: number; }
/** Id-less push during translate() generation: one per token, each carrying the
 *  cleaned full accumulation so far (not a delta) — same shape choice as AsrPartialMsg. */
export interface TranslatePartialMsg { type: 'translate_partial'; text: string; }
export interface AsrPartialMsg { type: 'partial'; text: string; }
export interface AsrResultMsg { type: 'result'; text: string; startSample?: number; durationMs: number; recognitionTimeMs: number; }
export type NativeModelState = 'ready' | 'absent';
export interface ModelStatusResultMsg { type: 'model_status_result'; id: number; statuses: Record<string, NativeModelState>; }
export interface ModelDeleteResultMsg { type: 'model_delete_result'; id: number; model: string; freed: number; }
export interface ModelProgressMsg { type: 'model_progress'; model: string; downloaded: number; total: number; }
export type ModelDownloadStatus = 'ready' | 'cancelled';
export interface ModelDownloadDoneMsg { type: 'model_download_done'; model: string; status: ModelDownloadStatus; }
export interface TtsChunkMsg { type: 'tts_chunk'; id: number; seq: number; }
export interface TtsDoneMsg { type: 'tts_done'; id: number; totalSamples: number; generationTimeMs: number; }
/** `voices` is the flat preset-name list the sidecar's tts_voices.list_builtin_voices
 *  returns (sidecar-v0.2.0+); see NativeVoiceInfo for why it is not the descriptor. */
export interface ListTtsVoicesResultMsg { type: 'list_tts_voices_result'; id: number; voices: string[]; }
export type ServerMsg = ReadyMsg | OkMsg | TtsGenerateResultMsg | TranslateResultMsg | TranslatePartialMsg | AsrPartialMsg | AsrResultMsg | ModelStatusResultMsg | ModelDeleteResultMsg | ModelProgressMsg | ModelDownloadDoneMsg | ErrorMsg | HardwareInfoResultMsg | ModelsCatalogResultMsg | ListVariantsResultMsg | TtsChunkMsg | TtsDoneMsg | ListTtsVoicesResultMsg;
