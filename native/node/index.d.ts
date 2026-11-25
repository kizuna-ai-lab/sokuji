export interface NativeError extends Error { name: 'NativeError'; status: number }
export type DeviceKind = 'cpu' | 'vulkan' | 'metal' | 'other';
export interface Device { index: number; kind: DeviceKind; name: string; description: string; memTotal: number; memFree: number }
export interface DeviceProfile { index: number; kind: DeviceKind; name: string; description: string; memTotal: number;
  known: boolean; features: string[]; driverName: string; driverVersion: string; deviceUuid: string; cpuFeatures: string }
export interface OpCoverage { allSupported: boolean; unsupported: string[]; checked: string[] }
export interface InitOptions { moduleDir: string; threads?: number; onLog?: (level: 0 | 1 | 2 | 3, message: string) => void }
export interface RunOptions { signal?: AbortSignal }

export function abi(): number;                                   // sk_abi_version()
export function version(): string;                               // sk_version()
export function engineVersions(): Record<string, string>;        // parsed "k=v;k=v"
export function contract(dir: string): { abi: number; version: string; lane: string; [k: string]: unknown };
export function init(opts: InitOptions): { threads: number };    // idempotent; first call wins
export function devices(): Device[];
export function deviceFreeMem(index: number): number;
export function deviceProfiles(): DeviceProfile[];
export function deviceSupportsOps(index: number, stage: 'asr' | 'translate' | 'tts', family: string, weightDtypes: string[]): Promise<OpCoverage>;
export function audioFamilies(): string[];
export function resample(pcm: Float32Array, channels: number, fromRate: number, toRate: number): Float32Array;

// Lifetimes, the same for AsrModel, Translator and Tts:
//  - unload() resolves once the model is freed, on the handle's own thread. Calls still queued
//    reject with status -5 ("cancelled before it started"); the call running stops at its next
//    native callback and rejects with -5 as well. One that cannot be interrupted (an ASR encoder
//    pass, an offline synth) runs to its end first. Every unload() returns the same promise.
//  - A call made once unload() has been called rejects with status -2, "<fn>: model is unloaded".
//  - Call unload(). A handle garbage-collected without it is unloaded by its finalizer (on its
//    own thread, not the JS thread), and a warning naming it goes to onLog and to stderr.
//  - process.exit() stops every handle's thread before the process ends, so it waits for a call
//    that cannot be interrupted. The same holds when a worker_threads Worker is terminated.
export interface AsrCaps { languages: string[]; supportsStreaming: boolean; supportsLanguageDetect: boolean; nativeSampleRate: number; arch: string }
export interface StreamText { committed: string; tentative: string }
export interface AsrStream {
  feed(pcm: Float32Array): Promise<StreamText>;
  finalize(opts?: RunOptions): Promise<string>;   // closes the stream
  close(): void;                                  // idempotent
}
export interface AsrModel {
  readonly capabilities: AsrCaps;
  run(pcm: Float32Array, language: string | null, opts?: RunOptions & { onProgress?: () => void }): Promise<string>;
  openStream(language: string | null): AsrStream;
  unload(): Promise<void>;                        // idempotent
}
export function asrLoad(path: string, deviceIndex: number | null): Promise<AsrModel>;

export interface ChatMessage { role: string; content: string }
export interface GenOptions { maxTokens?: number; assistantPrefill?: string }
export interface Translator {
  chat(messages: ChatMessage[], gen: GenOptions, opts: RunOptions & { onToken: (bytes: Uint8Array) => void }): Promise<void>;
  complete(prompt: string, gen: Omit<GenOptions, 'assistantPrefill'>, opts: RunOptions & { onToken: (bytes: Uint8Array) => void }): Promise<void>;
  unload(): Promise<void>;
}
export function translateLoad(path: string, deviceIndex: number | null, opts?: { nCtx?: number; flashAttn?: 0 | 1 | 2 }): Promise<Translator>;

export interface TtsCaps { streaming: boolean; clones: boolean; transcriptRequired: boolean; sampleRate: number }
export interface Tts {
  readonly capabilities: TtsCaps;
  presets(): Promise<string[]>;
  setVoice(pcm: Float32Array, sampleRate: number, refText: string | null): Promise<void>;
  setPreset(name: string): Promise<void>;
  synth(text: string, language: string | null, speed: number,
        opts: RunOptions & { onAudio: (pcm: Float32Array, sampleRate: number, channels: number) => void }): Promise<void>;
  unload(): Promise<void>;
}
export function ttsLoad(path: string, deviceIndex: number | null, opts: { family: string; language?: string | null }): Promise<Tts>;
