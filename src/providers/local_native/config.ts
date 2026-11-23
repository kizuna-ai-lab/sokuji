import type { SessionContext } from '../../lib/contract/adapter';
import type { LegName } from '../../lib/conversation/types';
import { voiceCapability, type VoiceCapability } from '../../lib/local-inference/native/nativeCatalog';
import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import type { NativeDevice } from '../../lib/local-inference/native/nativeCatalog';
import type { NativeHost, NativeModels } from '../../lib/local-inference/native/nativeModels';
import type { TtsUnavailableCode } from '../../lib/local-inference/sessions/speech';
import type { ProviderRefusal, SharedSettings } from '../../lib/run/types';
import type { LocalNativeSettings } from './settings';

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
 * decided here, from this device's native facts — never in the adapter (spec:
 * "Structural gaps"). `host` is what the session asks of the app around it
 * (#578 ruling 18).
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
  /** Voices, clip stores, the machine, and where each stage's plan is shown. `describe` and `admit` ignore it. */
  host: NativeHost;
  /** The transcription unit's config: only source segments are said, each final stating all of it stable. */
  transcribesAlone?: true;
  /** A leg that should speak but has no voice for its target: said once at the start, as LocalInference's (#619). */
  ttsUnavailable?: TtsUnavailableCode;
}

/** LocalInference's prompt rule (its `config.ts`), the same here: template mode uses the default; else the speaker's prompt, or, for the reverse direction, its own. */
export function localInstructions(context: SessionContext, s: LocalNativeSettings, shared: SharedSettings): string {
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
 * `asrLoadsFirst`, unchanged): a GPU-only model (catalog tiers, none `cpu`)
 * loads first; when both or neither are GPU-only, the larger download, ASR on
 * a tie or when neither size is known; ASR first without a translation stage.
 * The sizes come with the catalog, so "no catalog" is "no sizes" in practice.
 */
export function asrLoadsFirst(
  asrId: string,
  translationId: string | undefined,
  catalog: Readonly<Record<string, NativeModelInfo>>,
  sizes: Readonly<Record<string, number>>,
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

/** A direction with no recognition model, as the whole session and the transcription unit refuse it. */
export function noAsr(source: string): ProviderRefusal {
  return { refused: `No speech recognition model for ${source}.`, code: 'no_asr', params: { source } };
}

/**
 * This device's native facts as a run hands them to a builder or to `admit` (`shared.nativeModels`). A run always
 * hands them; a caller that is not a run never builds Local Native.
 */
export function nativeModelsOf(shared: Pick<SharedSettings, 'nativeModels'>): NativeModels {
  if (!shared.nativeModels) throw new Error("The Local Native build was asked without this device's native models (SharedSettings.nativeModels).");
  return shared.nativeModels;
}

/** Local Native's builder, called once per leg: `context.direction` names the leg's direction. */
export function buildLocalNative(
  context: SessionContext,
  s: LocalNativeSettings,
  shared: SharedSettings,
): LocalNativeConfig | ProviderRefusal {
  const { source, target } = context.direction;
  const facts = nativeModelsOf(shared);
  const resolved = facts.resolve(source, target, s.selections);
  if (!resolved.asr) return noAsr(source);

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
    asrFirst: asrLoadsFirst(asr.modelId, translation?.modelId, facts.catalog(), facts.sizes()),
    host: facts,
  };
  if (shared.segmentation.mode === 'sentences') config.jobSentences = shared.segmentation.sentencesPerRow;
  if (context.speech && resolved.tts) {
    const catalog = facts.catalog();
    config.tts = {
      ...stage(resolved.tts, s.ttsDevice),
      speed: s.ttsSpeed,
      voice: s.ttsVoice,
      capability: catalog[resolved.tts.modelId] ? voiceCapability(catalog[resolved.tts.modelId]) : null,
    };
  } else if (context.speech) {
    config.ttsUnavailable = shared.reversed(context.direction) ? 'participant_tts_missing' : 'speaker_tts_missing';
  }
  return config;
}

export function describeLocalNative(c: LocalNativeConfig): { asrModel?: string; translationModel?: string; ttsModel?: string } {
  return { asrModel: c.asr.modelId, translationModel: c.translation?.modelId, ttsModel: c.tts?.modelId };
}

/** The `admit_refused` notice's detail (#578 ruling 4). */
export const ONE_SIDE_AT_A_TIME = 'Local Native translates one side at a time: choose Me or Other.';

/**
 * Two legs are refused until the engine keeps one engine per connection
 * (spec: "Parameters and deferred decisions"): today one engine per stage
 * serves the whole process, so the second leg's init evicts the first's
 * model and the first leg to close unloads both (#578 ruling 4).
 */
export function oneSideAtATime(configs: Partial<Record<LegName, unknown>>, detail: string): true | ProviderRefusal {
  return configs.speaker && configs.participant ? { refused: detail } : true;
}

export function admitLocalNative(configs: Partial<Record<LegName, LocalNativeConfig>>): true | ProviderRefusal {
  return oneSideAtATime(configs, ONE_SIDE_AT_A_TIME);
}
