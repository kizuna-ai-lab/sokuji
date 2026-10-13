import type { SessionContext } from '../../lib/contract/adapter';
import type { LegName } from '../../lib/conversation/types';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { useModelStore } from '../../stores/modelStore';
import { guardAstCrossStage } from '../../services/providers/astGuard';
import { getManifestEntry, estimateModelMemoryByDevice } from '../../lib/local-inference/modelManifest';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import { effectiveCheckAfter, supportsSmartTurn } from '../../lib/turn/smartTurn';
import { directionKey } from '../../lib/local-inference/selection/types';
import type { AdmittedConfigs } from '../../lib/session/types';
import type { LocalInferenceSettings } from './settings';
import { directionVoice, speakerIdFor } from './voices';

/** Why a leg that should speak will not (#619): the notice code its adapter emits at the start. */
export type TtsUnavailableCode = 'speaker_tts_missing' | 'participant_tts_missing' | 'participant_tts_over_budget';

/**
 * LocalInference's `C` (spec: "`C`, the config `build` returns"). Ports
 * `LocalInferenceSessionConfig` (`src/services/interfaces/IClient.ts`) minus
 * the fields the new contract already carries elsewhere: direction (`context`),
 * `provider`/`model`/`temperature`/`maxTokens` (dead), `textOnly` (`context.speech`),
 * `keepReplayAudio` (L1), `turnDetectionMode` (the global turn mode + `context.turns`).
 */
export interface LocalInferenceConfig {
  asr: { modelId: string; streaming: boolean };
  vad: { threshold: number; negativeThreshold?: number; minSilenceDuration: number; minSpeechDuration: number; maxSpeechDuration: number; preSpeechPadDuration: number; smartTurn?: { checkAfter: number; threshold: number } };
  translation:
    | { kind: 'engine'; modelId: string; instructions: string; wrapTranscript: boolean }
    | { kind: 'ast' }
    | { kind: 'none' };
  tts?: { modelId: string; speakerId: number; speed: number; edgeVoice?: string };
  /**
   * Set when this leg should speak but will not (#619): no TTS model speaks
   * its target, or the memory budget dropped the other side's speech model.
   * The adapter says so once, at the start.
   */
  ttsUnavailable?: TtsUnavailableCode;
  /**
   * The translation-job cut, from the display's segmentation (today's three
   * shapes): absent — the display is not by sentences, one raw job per ASR
   * final; 0 (Auto) — one job per final, punctuated first; 1–5 — a job every
   * N sentences inside the utterance (the stream shape, when a punctuator
   * runs).
   */
  jobSentences?: number;
}

/**
 * The local prompt — mirrors today's `getProcessedLocalPrompt`
 * (`src/stores/settingsStore.ts` ~1461-1479) exactly, trimming before each
 * blank check and falling back in the same order: template mode always uses
 * the built-in default for this direction; otherwise the speaker prompt is
 * trimmed and, if blank, replaced by the default — the reversed
 * (participant) direction then prefers its own prompt (trimmed), falling
 * back to that already-resolved speaker value when it too is blank. This is
 * LocalInference's own prompt mechanism: every provider owns its instructions
 * (Stage 2 Gemini, ruling 4).
 */
function localInstructions(context: SessionContext, s: LocalInferenceSettings, shared: SharedSettings): string {
  const { source, target } = context.direction;
  if (s.useTemplateMode) return buildDefaultLocalPrompt(source, target);

  const speakerResolved = s.systemPrompt.trim() || buildDefaultLocalPrompt(source, target);
  if (!shared.reversed(context.direction)) return speakerResolved;

  const participant = s.participantSystemPrompt.trim();
  return participant || speakerResolved;
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
    preSpeechPadDuration: s.vadPreSpeechPadDuration,
  };
  if (s.vadNegativeThreshold) vad.negativeThreshold = s.vadNegativeThreshold;
  if (s.vadEndOfTurn === 'smart' && supportsSmartTurn(asrEntry)) {
    const checkAfter = effectiveCheckAfter(s.smartTurnCheckAfter, s.vadMinSilenceDuration);
    if (checkAfter !== null) vad.smartTurn = { checkAfter, threshold: s.smartTurnThreshold };
  }

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

  const config: LocalInferenceConfig = { asr, vad, translation };
  if (shared.segmentation.mode === 'sentences') config.jobSentences = shared.segmentation.sentencesPerRow;
  if (context.speech && resolved.tts) {
    // Each direction speaks in its own voice (#619).
    const voice = directionVoice(s.voices, directionKey(source, target));
    config.tts = {
      modelId: resolved.tts.modelId,
      speakerId: speakerIdFor(voice, resolved.tts.modelId),
      speed: s.ttsSpeed,
      edgeVoice: voice.edge,
    };
  } else if (context.speech) {
    // Which leg this is, the runner tells outright (`shared.reversed`).
    config.ttsUnavailable = shared.reversed(context.direction) ? 'participant_tts_missing' : 'speaker_tts_missing';
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

/** The models these configs load: every leg's ASR, its translation model when a real engine loads (AST shares the ASR engine, so no second model to count), and TTS where a leg speaks. */
function modelIdsOf(configs: Partial<Record<LegName, LocalInferenceConfig>>): string[] {
  const ids: string[] = [];
  for (const config of Object.values(configs)) {
    if (!config) continue;
    ids.push(config.asr.modelId);
    if (config.translation.kind === 'engine') ids.push(config.translation.modelId);
    if (config.tts) ids.push(config.tts.modelId);
  }
  return ids;
}

/** Whether these models fit: VRAM only when its budget is set via localStorage (no API reports GPU memory), RAM always. */
function fitsBudget(modelIds: string[]): boolean {
  const { vramMb, ramMb } = estimateModelMemoryByDevice(modelIds, useModelStore.getState().deviceFeatures);
  const vramBudgetMb = readDebugNumber('debug:vram-budget');
  if (vramBudgetMb !== null && vramMb > vramBudgetMb) return false;
  const deviceMemoryGb = readDebugNumber('debug:device-memory')
    ?? (navigator as unknown as { deviceMemory?: number }).deviceMemory
    ?? DEFAULT_DEVICE_MEMORY_GB;
  return ramMb <= Math.round(deviceMemoryGb * RAM_BUDGET_RATIO * 1024);
}

/**
 * The memory budget (spec: "`admit`"; ports `createParticipantLocalInferenceConfig`'s
 * budget check, `localParticipantConfig.ts` ~96-124), summed over exactly the
 * configs given. When only the other side's speech model tips it (#619), that
 * leg runs text only and says why; a cloud speech model takes no memory, so
 * dropping one never helps. My own leg's speech model is never dropped.
 */
export function admitLocalInference(configs: Partial<Record<LegName, LocalInferenceConfig>>): true | ProviderRefusal | AdmittedConfigs<LocalInferenceConfig> {
  if (fitsBudget(modelIdsOf(configs))) return true;
  const refusal: ProviderRefusal = { refused: 'The models need more memory than this device has.', code: 'memory_exceeded' };
  const { participant } = configs;
  if (!participant?.tts) return refusal;
  const textOnly: LocalInferenceConfig = { ...participant, ttsUnavailable: 'participant_tts_over_budget' };
  delete textOnly.tts;
  if (!fitsBudget(modelIdsOf({ ...configs, participant: textOnly }))) return refusal;
  return { configs: { participant: textOnly } };
}
