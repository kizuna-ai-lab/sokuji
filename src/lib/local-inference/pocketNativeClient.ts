/**
 * Renderer-side client for the Electron-native Pocket runtime (utilityProcess).
 * Mirrors the slice of TtsEngine the dev playground uses, but generation runs natively
 * on onnxruntime-node in the main/utility process over window.electron.invoke.
 */
import type { TtsResult } from './engine/TtsEngine';

type StatusCallback = (message: string) => void;
type ErrorCallback = (error: string) => void;

interface ElectronInvoke {
  invoke(channel: string, data?: unknown): Promise<any>;
}
function electron(): ElectronInvoke {
  const e = (window as unknown as { electron?: ElectronInvoke }).electron;
  if (!e) throw new Error('window.electron is unavailable (not running in Electron)');
  return e;
}

export class PocketNativeClient {
  onStatus: StatusCallback | null = null;
  onError: ErrorCallback | null = null;

  async init(): Promise<{ backend: string; sampleRate: number; loadTimeMs: number }> {
    this.onStatus?.('[pocket-native] loading model in utilityProcess…');
    const r = await electron().invoke('pocket-native:init', {});
    this.onStatus?.(`[pocket-native] ready (loadMs=${r.loadTimeMs})`);
    return { backend: 'cpu-native', sampleRate: r.sampleRate, loadTimeMs: r.loadTimeMs };
  }

  async generateWithReference(
    text: string, referenceAudio: Float32Array | null, referenceSampleRate: number, speed = 1.0,
  ): Promise<TtsResult> {
    const payload = referenceAudio
      ? { text, referenceAudio, referenceSampleRate, speed }
      : { text, useCachedVoice: true, speed };
    const r = await electron().invoke('pocket-native:generate', payload);
    return { samples: r.samples as Float32Array, sampleRate: r.sampleRate, generationTimeMs: r.generationTimeMs };
  }
}
