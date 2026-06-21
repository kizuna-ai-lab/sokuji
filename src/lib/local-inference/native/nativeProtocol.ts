// WS message contract between the renderer and the python sidecar (Phase 1: TTS only).
export interface ReadyMsg { type: 'ready'; id: number; sampleRate: number; loadTimeMs: number; }
export interface OkMsg { type: 'ok'; id: number; }
export interface ResultMsg { type: 'result'; id: number; sampleRate: number; generationTimeMs: number; samples: number; }
export interface ErrorMsg { type: 'error'; id?: number; model?: string; message: string; }
export interface TranslationMsg { type: 'translation'; id: number; sourceText: string; translatedText: string; inferenceTimeMs: number; }
export interface SpeechStartMsg { type: 'speech_start'; }
export interface AsrResultMsg { type: 'result'; text: string; startSample?: number; durationMs: number; recognitionTimeMs: number; }
export type NativeModelState = 'ready' | 'absent';
export interface ModelStatusResultMsg { type: 'model_status_result'; id: number; statuses: Record<string, NativeModelState>; }
export interface ModelSizesResultMsg { type: 'model_sizes_result'; id: number; sizes: Record<string, number>; }
export interface ModelDeleteResultMsg { type: 'model_delete_result'; id: number; model: string; freed: number; }
export interface ModelProgressMsg { type: 'model_progress'; model: string; downloaded: number; total: number; }
export type ModelDownloadStatus = 'ready' | 'cancelled';
export interface ModelDownloadDoneMsg { type: 'model_download_done'; model: string; status: ModelDownloadStatus; }
export type ServerMsg = ReadyMsg | OkMsg | ResultMsg | TranslationMsg | SpeechStartMsg | AsrResultMsg | ModelStatusResultMsg | ModelSizesResultMsg | ModelDeleteResultMsg | ModelProgressMsg | ModelDownloadDoneMsg | ErrorMsg;
