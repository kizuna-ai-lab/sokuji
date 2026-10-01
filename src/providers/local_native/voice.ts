import { eligibleCustomVoices, requiresVoiceClip, voiceCapability, type VoiceCapability } from '../../lib/local-inference/native/nativeCatalog';
import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import { reconcileTtsVoice } from '../../lib/local-inference/native/nativeTtsVoiceReconciliation';
import type { LocalNativeConfig } from './config';
import type { NativeTtsLike, NativeTtsReady } from './engines';
import type { NativeHost } from './host';

type TtsConfig = NonNullable<LocalNativeConfig['tts']>;

/**
 * The renderer's mirror of the sidecar's R16 pre-check: a model that reports
 * `voice.required` cannot speak without a stored clip, known before it loads.
 * Storage that fails counts as no clip. A model the catalog does not list is
 * not gated, as the old client skipped it.
 */
export async function voiceClipMissing(config: TtsConfig, host: NativeHost): Promise<boolean> {
  const capability = config.capability;
  if (!capability || !requiresVoiceClip(capability)) return false;
  const store = host.voiceStore(capability.custom, config.modelId);
  if (!store) return true;
  try {
    return eligibleCustomVoices(await store.list(), capability.transcriptRequired).length === 0;
  } catch {
    return true;
  }
}

export interface AppliedVoice {
  /** What was applied: `builtin:<name>`, `custom:<id>`, or the stored value passed through. */
  voice: string;
  /** A stored custom clip no longer usable, swapped for another (R35). */
  substituted?: { from: string; to: string };
}

/**
 * The stored voice reconciled against what this model and this device hold,
 * and applied (the old client's `connect()`, next-session semantics). The
 * catalog's capability, or the init reply's `clones` when the catalog does
 * not list the model. Storage failing leaves the built-in voices only.
 */
export async function applyVoice(
  tts: NativeTtsLike,
  config: TtsConfig,
  language: string,
  ready: NativeTtsReady,
  host: NativeHost,
): Promise<AppliedVoice> {
  const capability: VoiceCapability = config.capability ?? voiceCapability({ clones: ready.clones } as unknown as NativeModelInfo);
  const store = host.voiceStore(capability.custom, config.modelId);
  let customIds: number[] = [];
  if (store) {
    try {
      customIds = eligibleCustomVoices(await store.list(), capability.transcriptRequired).map((v) => v.id);
    } catch { /* storage unavailable: built-in voices only */ }
  }
  const voices = capability.builtin === 'named' ? await host.listVoices(config.modelId) : [];
  const voice = reconcileTtsVoice(config.voice, customIds, language, voices, capability.custom !== 'none', capability.builtin === 'named');
  const applied: AppliedVoice = { voice };
  if (config.voice.startsWith('custom:') && voice.startsWith('custom:') && voice !== config.voice) {
    applied.substituted = { from: config.voice.slice('custom:'.length), to: voice.slice('custom:'.length) };
  }
  if (voice.startsWith('builtin:')) {
    await tts.setVoice(voice.slice('builtin:'.length));
  } else if (voice.startsWith('custom:') && store) {
    const payload = await store.resolveApply(Number(voice.slice('custom:'.length)));
    if (payload?.kind === 'clip') await tts.setReferenceVoice(payload.audio, payload.sampleRate, payload.transcript);
  }
  return applied;
}
