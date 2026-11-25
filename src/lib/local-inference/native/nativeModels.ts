import type { HardwareInfoResultMsg, NativeModelInfo, NativeVoiceInfo } from './nativeProtocol';
import type { NativeReadinessInput, NativeReadinessResult, VoiceCustom } from './nativeCatalog';
import type { DirectionResult, Selections } from '../selection/types';

export type NativeStage = 'asr' | 'translation' | 'tts';

/** What a stage's init reply reports: the sidecar's resolved plan. */
export interface NativeInitReport { loadTimeMs?: number; backend?: string; device?: string; computeType?: string; rtf?: number; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string }

/** A stage's resolved plan, as the library's device badges read it. */
export interface NativePlan extends NativeInitReport { model: string; device: string }

/** The custom-clip store a voice is applied from: what a session reads of `NativeVoiceStore`. */
export interface NativeClipStore {
  list(): Promise<Array<{ id: number; name: string; hasTranscript?: boolean }>>;
  resolveApply(id: number): Promise<{ kind: 'clip'; audio: Float32Array; sampleRate: number; transcript?: string } | null>;
}

/** What a unit's session asks of the app around it (#578 ruling 14): voices, clip stores, the machine, and where each stage's plan is shown. */
export interface NativeHost {
  listVoices(modelId: string): Promise<NativeVoiceInfo[]>;
  voiceStore(custom: VoiceCustom, modelId: string): NativeClipStore | null;
  hardware(): Promise<HardwareInfoResultMsg | null>;
  plan(stage: NativeStage, plan: NativePlan): void;
}

/**
 * This device's native facts, as Local Native reads them (#578 ruling 18): what a direction resolves to among the
 * sidecar's catalog and downloads, the catalog and download sizes its builders read, the readiness gate, and when
 * any of it changes; and, for its sessions, the host. The app gives it (`src/stores/nativeModels.ts`) as it gives
 * `LocalModels`: a run to every builder (`SharedSettings.nativeModels`) and to `admit`, the provider store to a
 * local provider's check (`CheckContext.nativeModels`), the readiness driver to `watchReadiness`.
 */
export interface NativeModels extends NativeHost {
  resolve(source: string, target: string, selections: Selections): DirectionResult;
  catalog(): Readonly<Record<string, NativeModelInfo>>;
  sizes(): Readonly<Record<string, number>>;
  /** The gate; rejects with the abort reason when `signal` fires first. */
  ensureSelectionReady(read: () => NativeReadinessInput, signal?: AbortSignal): Promise<NativeReadinessResult>;
  /** Calls back once per change of what readiness reads (never while the sidecar is `starting`); returns the unsubscribe. */
  watch(onChange: () => void): () => void;
}
