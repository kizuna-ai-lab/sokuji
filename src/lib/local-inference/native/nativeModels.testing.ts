import type { NativeModels } from './nativeModels';

/** A `NativeModels` for tests: nothing resolves, nothing is downloaded, the gate says ready, and the host does nothing. */
export function fakeNativeModels(over: Partial<NativeModels> = {}): NativeModels {
  return {
    resolve: () => ({ asr: null, translation: null, tts: null, notes: [], prunes: [] }),
    catalog: () => ({}),
    sizes: () => ({}),
    ensureSelectionReady: async () => ({ ready: true, reason: 'ready', notes: [] }),
    watch: () => () => {},
    listVoices: async () => [],
    voiceStore: () => null,
    hardware: async () => null,
    plan: () => {},
    ...over,
  };
}
