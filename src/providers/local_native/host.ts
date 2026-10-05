import type { VoiceCustom } from '../../lib/local-inference/native/nativeCatalog';
import type { HardwareInfoResultMsg, NativeVoiceInfo } from '../../lib/local-inference/native/nativeProtocol';
import type { NativeVoiceStore } from '../../lib/local-inference/native/nativeVoiceStores';
import type { NativeInitReport } from './engines';

export type NativeStage = 'asr' | 'translation' | 'tts';

/** A stage's resolved plan, as the library's badges read it. */
export interface NativePlan extends NativeInitReport {
  model: string;
  device: string;
}

/**
 * What the adapter asks of the app around it. The definition hands it in
 * (`bridge.ts`), so the session side imports no store (#578 ruling 14); tests
 * hand in a fake.
 */
export interface NativeHost {
  /** Built-in voice names for a voice-capable model; [] when unavailable. */
  listVoices(modelId: string): Promise<NativeVoiceInfo[]>;
  /** The custom-clip store for a capability, or null when the model takes none. */
  voiceStore(custom: VoiceCustom, modelId: string): NativeVoiceStore | null;
  /** A machine snapshot for the Logs panel; null when unavailable. */
  hardware(): Promise<HardwareInfoResultMsg | null>;
  /** The sidecar's resolved plan for one stage. */
  plan(stage: NativeStage, plan: NativePlan): void;
}
