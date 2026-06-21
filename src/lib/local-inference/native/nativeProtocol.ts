// WS message contract between the renderer and the python sidecar (Phase 1: TTS only).
export interface ReadyMsg { type: 'ready'; id: number; sampleRate: number; loadTimeMs: number; }
export interface OkMsg { type: 'ok'; id: number; }
export interface ResultMsg { type: 'result'; id: number; sampleRate: number; generationTimeMs: number; samples: number; }
export interface ErrorMsg { type: 'error'; id?: number; message: string; }
export type ServerMsg = ReadyMsg | OkMsg | ResultMsg | ErrorMsg;
