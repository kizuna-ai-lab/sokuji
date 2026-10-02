import type { SessionContext } from '../../lib/contract/adapter';
import type { LegName } from '../../lib/conversation/types';
import { voiceCapability, type VoiceCapability } from '../../lib/local-inference/native/nativeCatalog';
import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import type { LocalNativeSettings, NativeDevice } from './settings';

/** One sidecar stage: the model, its pinned quant, and the device the settings ask for. */
export interface NativeStageConfig {
  modelId: string;
  variant?: string;
  device: NativeDevice;
}

/**
 * Local Native's `C`. Ports `LocalNativeSessionConfig` minus what the contract
 * carries elsewhere (direction, `textOnly` as `context.speech`, replay, turn
 * mode). Model resolution, the voice capability and the load order are
 * decided here, from the native model store — never in the adapter (spec:
 * "Structural gaps").
 */
export interface LocalNativeConfig {
  asr: NativeStageConfig;
  vad: { threshold: number; minSilenceDuration: number; minSpeechDuration: number };
  /** Null: no translation model resolved, so the leg is transcription only. */
  translation: (NativeStageConfig & { instructions: string; wrapTranscript: boolean }) | null;
  /** Set only where the leg speaks. `capability`: the catalog's voice capability for the model; null while the catalog does not list it (the adapter then reads the init reply's `clones`, as the old client did). */
  tts?: NativeStageConfig & { speed: number; voice: string; capability: VoiceCapability | null };
  /** ASR loads before translation (#578 ruling 15). */
  asrFirst: boolean;
  /** As LocalInference's: absent — one job per final; 0 — Auto; 1–5 — a job every N sentences. */
  jobSentences?: number;
}

/** LocalInference's prompt rule (its `config.ts`), the same here: template mode uses the default; else the speaker's prompt, or, for the reverse direction, its own. */
function localInstructions(context: SessionContext, s: LocalNativeSettings, shared: SharedSettings): string {
  const { source, target } = context.direction;
  if (s.useTemplateMode) return buildDefaultLocalPrompt(source, target);
  const speakerResolved = s.systemPrompt.trim() || buildDefaultLocalPrompt(source, target);
  if (!shared.reversed(context.direction)) return speakerResolved;
  return s.participantSystemPrompt.trim() || speakerResolved;
}

function stage(resolved: { modelId: string; variant?: string }, device: NativeDevice): NativeStageConfig {
  return { modelId: resolved.modelId, ...(resolved.variant ? { variant: resolved.variant } : {}), device };
}

/**
 * Which stage claims VRAM first (#578 ruling 15; the old client's
 * `asrLoadsFirst`): a GPU-only model (catalog tiers, none `cpu`) loads first;
 * when both or neither are GPU-only, the larger download; ASR first without
 * a translation stage or catalog data.
 */
export function asrLoadsFirst(
  asrId: string,
  translationId: string | undefined,
  catalog: Record<string, NativeModelInfo>,
  sizes: Record<string, number>,
): boolean {
  if (!translationId) return true;
  const gpuOnly = (id: string): boolean => {
    const info = catalog[id];
    return !!info && info.tiers.length > 0 && !info.tiers.some((t) => t.tier === 'cpu');
  };
  const asrGpuOnly = gpuOnly(asrId);
  if (asrGpuOnly !== gpuOnly(translationId)) return asrGpuOnly;
  return (sizes[asrId] ?? 0) >= (sizes[translationId] ?? 0);
}

/** Local Native's builder, called once per leg: `context.direction` names the leg's direction. */
export function buildLocalNative(
  context: SessionContext,
  s: LocalNativeSettings,
  shared: SharedSettings,
): LocalNativeConfig | ProviderRefusal {
  const { source, target } = context.direction;
  const store = useNativeModelStore.getState();
  const resolved = store.resolve(source, target, s.selections);
  if (!resolved.asr) {
    return { refused: `No speech recognition model for ${source}.`, code: 'no_asr', params: { source } };
  }

  let translation: LocalNativeConfig['translation'] = null;
  if (resolved.translation) {
    const instructions = localInstructions(context, s, shared);
    const wrapTranscript = s.useTemplateMode
      || instructions === buildDefaultLocalPrompt(source, target)
      || instructions === buildDefaultLocalPrompt(target, source);
    translation = { ...stage(resolved.translation, s.translationDevice), instructions, wrapTranscript };
  }

  const asr = stage(resolved.asr, s.asrDevice);
  const config: LocalNativeConfig = {
    asr,
    vad: { threshold: s.vadThreshold, minSilenceDuration: s.vadMinSilenceDuration, minSpeechDuration: s.vadMinSpeechDuration },
    translation,
    asrFirst: asrLoadsFirst(asr.modelId, translation?.modelId, store.catalog, store.sizes),
  };
  if (shared.segmentation.mode === 'sentences') config.jobSentences = shared.segmentation.sentencesPerRow;
  if (context.speech && resolved.tts) {
    config.tts = {
      ...stage(resolved.tts, s.ttsDevice),
      speed: s.ttsSpeed,
      voice: s.ttsVoice,
      capability: store.catalog[resolved.tts.modelId] ? voiceCapability(store.catalog[resolved.tts.modelId]) : null,
    };
  }
  return config;
}

export function describeLocalNative(c: LocalNativeConfig): { asrModel?: string; translationModel?: string; ttsModel?: string } {
  return { asrModel: c.asr.modelId, translationModel: c.translation?.modelId, ttsModel: c.tts?.modelId };
}

/** The `admit_refused` notice's detail (#578 ruling 4). */
export const ONE_SIDE_AT_A_TIME = 'Local Native translates one side at a time: choose Me or Other.';

/**
 * Two legs are refused until the sidecar keeps one engine per connection
 * (spec: "Parameters and deferred decisions"): today one engine per stage
 * serves the whole process, so the second leg's init evicts the first's
 * model and the first leg to close unloads both.
 */
export function admitLocalNative(configs: Partial<Record<LegName, LocalNativeConfig>>): true | ProviderRefusal {
  return configs.speaker && configs.participant ? { refused: ONE_SIDE_AT_A_TIME } : true;
}
