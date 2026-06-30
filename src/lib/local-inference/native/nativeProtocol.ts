// WS message contract between the renderer and the python sidecar (TTS, translation, ASR, model management, hardware info).
export interface ReadyMsg {
  type: 'ready'; id: number; sampleRate?: number; loadTimeMs: number;   // sampleRate only on audio (ASR/TTS) ready; translate_init omits it
  backend?: string; device?: string; computeType?: string; rtf?: number; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string;
  streaming?: boolean; clones?: boolean;
}
export interface NativeTier { tier: string; backend: string; available: boolean; }
export interface NativeModelInfo {
  id: string; name: string; languages: string[]; recommended: boolean; tiers: NativeTier[];
  order: number; repo: string; kind: 'asr' | 'translate' | 'tts';
  numSpeakers?: number; clones?: boolean; streaming?: boolean;   // tts only
  sizeBytes?: number;   // total download size; 0/absent = unknown
}
export interface NativeVoiceInfo {
  name: string; language?: string; curated: boolean; unstable: boolean; default: boolean;
}
export interface HardwareInfoResultMsg {
  type: 'hardware_info_result'; id: number;
  os: string; arch: string; cpuCores: number;
  gpus: { vendor: string; name: string; vramMb: number }[];
  backendsInstalled: string[]; accelAvailable: boolean;
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
export interface ResultMsg { type: 'result'; id: number; sampleRate: number; generationTimeMs: number; samples: number; }
export interface ErrorMsg { type: 'error'; id?: number; model?: string; message: string; }
export interface TranslationMsg { type: 'translation'; id: number; sourceText: string; translatedText: string; inferenceTimeMs: number; }
export interface SpeechStartMsg { type: 'speech_start'; }
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
export interface ListTtsVoicesResultMsg { type: 'list_tts_voices_result'; id: number; voices: NativeVoiceInfo[]; }
export type ServerMsg = ReadyMsg | OkMsg | ResultMsg | TranslationMsg | SpeechStartMsg | AsrPartialMsg | AsrResultMsg | ModelStatusResultMsg | ModelDeleteResultMsg | ModelProgressMsg | ModelDownloadDoneMsg | ErrorMsg | HardwareInfoResultMsg | ModelsCatalogResultMsg | ListVariantsResultMsg | TtsChunkMsg | TtsDoneMsg | ListTtsVoicesResultMsg;
