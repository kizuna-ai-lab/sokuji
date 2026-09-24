import type { SessionContext } from '../../lib/contract/adapter';
import type { LegName } from '../../lib/conversation/types';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { useModelStore } from '../../stores/modelStore';
import { guardAstCrossStage } from '../../services/providers/astGuard';
import { getManifestEntry, estimateModelMemoryByDevice } from '../../lib/local-inference/modelManifest';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import type { LocalInferenceSettings } from './settings';

/**
 * LocalInference's `C` (spec: "`C`, the config `build` returns"). Ports
 * `LocalInferenceSessionConfig` (`src/services/interfaces/IClient.ts`) minus
 * the fields the new contract already carries elsewhere: direction (`context`),
 * `provider`/`model`/`temperature`/`maxTokens` (dead), `textOnly` (`context.speech`),
 * `keepReplayAudio` (L1), `turnDetectionMode` (the global turn mode + `context.turns`).
 */
export interface LocalInferenceConfig {
  asr: { modelId: string; streaming: boolean };
  vad: { threshold: number; negativeThreshold?: number; minSilenceDuration: number; minSpeechDuration: number; maxSpeechDuration: number };
  translation:
    | { kind: 'engine'; modelId: string; instructions: string; wrapTranscript: boolean }
    | { kind: 'ast' }
    | { kind: 'none' };
  tts?: { modelId: string; speakerId: number; speed: number; edgeVoice?: string };
  /** Punctuate the job text before translating (today's Auto shape); the stream shape is plan 1e-2b's. */
  punctuateJobs: boolean;
}

/**
 * The local prompt (today's `getProcessedLocalPrompt`, `src/stores/settingsStore.ts`
 * ~1461-1479): template mode always uses the built-in default for this
 * direction; otherwise the reversed (participant) direction prefers its own
 * prompt, falling back to the speaker's, and either way a blank result falls
 * back to the default. This is LocalInference's own prompt mechanism — it
 * never calls `shared.instructions()` (ruling 3).
 */
function localInstructions(context: SessionContext, s: LocalInferenceSettings, shared: SharedSettings): string {
  const { source, target } = context.direction;
  if (s.useTemplateMode) return buildDefaultLocalPrompt(source, target);

  const raw = shared.reversed(context.direction)
    ? (s.participantSystemPrompt.trim() || s.systemPrompt)
    : s.systemPrompt;
  return raw.trim() ? raw : buildDefaultLocalPrompt(source, target);
}

/**
 * LocalInference's builder (spec: "`build`"). Ports `buildSessionConfig` /
 * `buildParticipantSessionConfig` (`LocalInferenceProviderConfig.ts`): model
 * resolution and the AST cross-stage guard run here, once, for whichever
 * direction `context.direction` names — the reversed (participant) direction
 * is just a different `context.direction`, not a separate code path.
 */
export function buildLocalInference(
  context: SessionContext,
  s: LocalInferenceSettings,
  shared: SharedSettings,
): LocalInferenceConfig | ProviderRefusal {
  const { source, target } = context.direction;
  const rawResolved = useModelStore.getState().resolve(source, target, s.selections);
  // AST cross-stage guard (see astGuard.ts): downgrades an explicit
  // AST-mismatched translation pick back to auto before it is judged.
  const resolved = guardAstCrossStage(
    source, target, s.selections, rawResolved,
    (masked) => useModelStore.getState().resolve(source, target, masked));

  if (!resolved.asr) {
    return { refused: `No speech recognition model for ${source}.`, code: 'no_asr', params: { source } };
  }

  const asrEntry = getManifestEntry(resolved.asr.modelId);
  const asr = { modelId: resolved.asr.modelId, streaming: asrEntry?.type === 'asr-stream' };

  const vad: LocalInferenceConfig['vad'] = {
    threshold: s.vadThreshold,
    minSilenceDuration: s.vadMinSilenceDuration,
    minSpeechDuration: s.vadMinSpeechDuration,
    maxSpeechDuration: s.vadMaxSpeechDuration,
  };
  if (s.vadNegativeThreshold) vad.negativeThreshold = s.vadNegativeThreshold;

  // Today's inference (LocalInferenceClient.ts ~406-408): the ASR model
  // handles translation itself (Granite Speech) when it was also picked,
  // explicitly, as the translation stage.
  const isAst = asrEntry?.asrEngine === 'granite-speech' && resolved.translation?.modelId === resolved.asr.modelId;

  let translation: LocalInferenceConfig['translation'];
  if (isAst) {
    translation = { kind: 'ast' };
  } else if (!resolved.translation) {
    translation = { kind: 'none' };
  } else {
    const instructions = localInstructions(context, s, shared);
    const defaultForward = buildDefaultLocalPrompt(source, target);
    const defaultReverse = buildDefaultLocalPrompt(target, source);
    const wrapTranscript = instructions === defaultForward || instructions === defaultReverse;
    translation = { kind: 'engine', modelId: resolved.translation.modelId, instructions, wrapTranscript };
  }

  const config: LocalInferenceConfig = {
    asr,
    vad,
    translation,
    // Auto shape only (ruling 1): the fill-in size punctuates the job text
    // before translating; the stream shape ships in plan 1e-2b.
    punctuateJobs: shared.segmentation.mode === 'sentences',
  };
  if (context.speech && resolved.tts) {
    config.tts = {
      modelId: resolved.tts.modelId,
      speakerId: s.ttsSpeakerId,
      speed: s.ttsSpeed,
      edgeVoice: s.edgeTtsVoice || undefined,
    };
  }
  return config;
}

/** The models a built config used, for the "what's running" surfaces. AST: the ASR model doubles as the translation model. */
export function describeLocalInference(c: LocalInferenceConfig): { asrModel?: string; translationModel?: string; ttsModel?: string } {
  return {
    asrModel: c.asr.modelId,
    translationModel: c.translation.kind === 'engine' ? c.translation.modelId
      : c.translation.kind === 'ast' ? c.asr.modelId
      : undefined,
    ttsModel: c.tts?.modelId,
  };
}

/** Fraction of navigator.deviceMemory used as the system RAM model budget. */
const RAM_BUDGET_RATIO = 0.75;
/** Conservative fallback when navigator.deviceMemory is unavailable (GB). */
const DEFAULT_DEVICE_MEMORY_GB = 4;

/**
 * Read a numeric localStorage debug override, returning null if absent.
 * Override keys:
 *   debug:vram-budget  — VRAM budget in MB (e.g. "8192" for 8 GB)
 *   debug:device-memory — system RAM in GB (e.g. "4")
 */
function readDebugNumber(key: string): number | null {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) {
      const n = Number(v);
      if (!Number.isNaN(n) && n >= 0) return n;
    }
  } catch { /* localStorage unavailable */ }
  return null;
}

/**
 * The memory budget (spec: "`admit`"; ports `createParticipantLocalInferenceConfig`'s
 * budget check, `localParticipantConfig.ts` ~96-124), summed over exactly the
 * configs given: every leg's ASR, its translation model when a real engine
 * loads (AST shares the ASR engine — no second model to count), and TTS
 * where a leg speaks. Unlike today this also applies to a speaker-only run,
 * since the same budget is exceeded either way.
 */
export function admitLocalInference(configs: Partial<Record<LegName, LocalInferenceConfig>>): true | ProviderRefusal {
  const allModelIds: Array<string | undefined> = [];
  for (const config of Object.values(configs)) {
    if (!config) continue;
    allModelIds.push(config.asr.modelId);
    if (config.translation.kind === 'engine') allModelIds.push(config.translation.modelId);
    if (config.tts) allModelIds.push(config.tts.modelId);
  }

  const deviceFeatures = useModelStore.getState().deviceFeatures;
  const { vramMb, ramMb } = estimateModelMemoryByDevice(allModelIds, deviceFeatures);

  const refusal: ProviderRefusal = { refused: 'The models need more memory than this device has.', code: 'memory_exceeded' };

  // VRAM budget — only enforced when explicitly set via localStorage, since
  // there is no reliable API to detect GPU VRAM size.
  const vramBudgetMb = readDebugNumber('debug:vram-budget');
  if (vramBudgetMb !== null && vramMb > vramBudgetMb) return refusal;

  const deviceMemoryGb = readDebugNumber('debug:device-memory')
    ?? (navigator as unknown as { deviceMemory?: number }).deviceMemory
    ?? DEFAULT_DEVICE_MEMORY_GB;
  const ramBudgetMb = Math.round(deviceMemoryGb * RAM_BUDGET_RATIO * 1024);
  if (ramMb > ramBudgetMb) return refusal;

  return true;
}
