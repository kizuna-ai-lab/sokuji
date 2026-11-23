import { wordsFor } from '../../lib/words/forService';
import type { SessionContext } from '../../lib/contract/adapter';
import type { LegName } from '../../lib/conversation/types';
import { ALL_LOCAL_STAGES, localStagesOf, type LocalStages } from '../../lib/lineup/localStages';
import type { AdmittedConfigs, ProviderRefusal, SharedSettings } from '../../lib/run/types';
import { guardAstCrossStage } from '../../services/providers/astGuard';
import { getManifestEntry, estimateModelMemoryByDevice } from '../../lib/local-inference/modelManifest';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import { effectiveCheckAfter, supportsSmartTurn } from '../../lib/turn/smartTurn';
import { directionKey, type DirectionResult, type LocalModels } from '../../lib/local-inference/selection/types';
import type { LocalInferenceSettings } from './settings';
import { directionVoice, speakerIdFor } from './voices';
import type { LocalTtsConfig, TtsUnavailableCode } from '../../lib/local-inference/sessions/speech';

// Declared with the session code that reads them (`src/lib/local-inference/sessions/speech.ts`); re-exported here for the provider's callers.
export type { LocalTtsConfig, TtsUnavailableCode };

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
  tts?: LocalTtsConfig;
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
  /**
   * The recognition serves transcription alone (`buildLocalTranscription`): another unit translates what it hears.
   * Its translation is `none` and it has no voice; it says source segments only, each final stating that all of it
   * is stable, and says nothing of a missing translation. Absent: the whole session, as before.
   */
  transcribesAlone?: true;
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

/** The word list and the session background, as lines the translator's prompt ends with (spec §9); empty without them. */
function wordsNote(shared: SharedSettings): string {
  const w = wordsFor('local_inference', shared.words?.entries ?? [], shared.words?.background ?? '');
  return [
    w.terms ? `Keep these names and terms as written: ${w.terms.join(', ')}.` : '',
    w.translations ? `Translate these as given: ${w.translations.map(([from, to]) => `${from} → ${to}`).join('; ')}.` : '',
    w.background ? `About this session: ${w.background}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * What a translation model on this machine is told for a direction: the user's prompt, or the built-in one, and
 * the word list and session background as its last lines. One builder for the whole local session and for the
 * local translation as a unit of its own.
 */
export function localTranslationPrompt(context: SessionContext, s: LocalInferenceSettings, shared: SharedSettings): { instructions: string; wrapTranscript: boolean } {
  const { source, target } = context.direction;
  const own = localInstructions(context, s, shared);
  const defaultForward = buildDefaultLocalPrompt(source, target);
  const defaultReverse = buildDefaultLocalPrompt(target, source);
  // Whether the transcript is wrapped follows the prompt chosen, before the word list is added to it.
  const wrapTranscript = own === defaultForward || own === defaultReverse;
  const note = wordsNote(shared);
  return { instructions: note ? `${own}\n\n${note}` : own, wrapTranscript };
}

/**
 * Whether the local provider turns speech straight into the translation: a Granite Speech recognition model also
 * chosen, explicitly, as the translation model. Such a session gives no original text.
 */
export function translatesSpeechDirectly(asrModelId: string | undefined, translationModelId: string | undefined): boolean {
  return !!asrModelId && translationModelId === asrModelId && getManifestEntry(asrModelId)?.asrEngine === 'granite-speech';
}

/**
 * Which stages of the engine this machine serves, for the whole local session's build: from the line-up a run froze
 * at its start when it hands one over; every stage when none does (or it gives this provider no stage). Never null,
 * so this provider never resolves an online model (Bing and Edge are providers of their own).
 */
export function localStagesFor(shared: Pick<SharedSettings, 'lineUp'>): LocalStages {
  return localStagesOf(shared.lineUp ?? null) ?? ALL_LOCAL_STAGES;
}

/**
 * A direction's models as a session resolves them among this device's (`models`), with the AST cross-stage guard
 * (see astGuard.ts), which downgrades an explicit AST-mismatched translation pick back to auto before it is judged.
 * Always under stages: resolved with none, Bing and Edge would be among the choices.
 */
export function resolveLocal(direction: SessionContext['direction'], s: LocalInferenceSettings, stages: LocalStages, models: LocalModels): DirectionResult {
  const { source, target } = direction;
  const rawResolved = models.resolve(source, target, s.selections, stages);
  return guardAstCrossStage(
    source, target, s.selections, rawResolved,
    (masked) => models.resolve(source, target, masked, stages));
}

/**
 * This device's models as a run hands them to a builder or to `admit` (`shared.localModels`). A run always hands
 * them; a caller that is not a run has none to resolve through, and is told so rather than read from a store.
 */
export function localModelsOf(shared: Pick<SharedSettings, 'localModels'>): LocalModels {
  if (!shared.localModels) throw new Error("The local provider was built without this device's models (SharedSettings.localModels): only a run hands them.");
  return shared.localModels;
}

/** The voice a direction speaks in on `modelId`: each direction has its own (#619). */
export function localTts(direction: SessionContext['direction'], s: LocalInferenceSettings, modelId: string): LocalTtsConfig {
  const voice = directionVoice(s.voices, directionKey(direction.source, direction.target));
  return { modelId, speakerId: speakerIdFor(voice, modelId), speed: s.ttsSpeed };
}

/** Why a leg that should speak has no speech model. Which leg this is, the runner tells outright (`shared.reversed`). */
export function ttsMissingCode(direction: SessionContext['direction'], shared: Pick<SharedSettings, 'reversed'>): TtsUnavailableCode {
  return shared.reversed(direction) ? 'participant_tts_missing' : 'speaker_tts_missing';
}

/** Why a direction cannot be heard: no recognition model resolves for its source. */
export function noAsr(source: string): ProviderRefusal {
  return { refused: `No speech recognition model for ${source}.`, code: 'no_asr', params: { source } };
}

/**
 * The recognition of a direction whose recognition model is `asrModelId`: the model, whether it streams, and the VAD
 * with Smart Turn where the settings ask for it and the model's worker takes it. One builder for the whole local
 * session and for the local recognition as a unit of its own.
 */
export function localRecognition(s: LocalInferenceSettings, asrModelId: string): Pick<LocalInferenceConfig, 'asr' | 'vad'> {
  const asrEntry = getManifestEntry(asrModelId);
  const asr = { modelId: asrModelId, streaming: asrEntry?.type === 'asr-stream' };

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
  return { asr, vad };
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
  const { source } = context.direction;
  // A line-up says whether translation and speech go to this machine's models or to another provider.
  const resolved = resolveLocal(context.direction, s, localStagesFor(shared), localModelsOf(shared));

  if (!resolved.asr) return noAsr(source);

  const { asr, vad } = localRecognition(s, resolved.asr.modelId);

  // Today's inference (LocalInferenceClient.ts ~406-408): the ASR model
  // handles translation itself (Granite Speech) when it was also picked,
  // explicitly, as the translation stage.
  const isAst = translatesSpeechDirectly(resolved.asr.modelId, resolved.translation?.modelId);

  let translation: LocalInferenceConfig['translation'];
  if (isAst) {
    translation = { kind: 'ast' };
  } else if (!resolved.translation) {
    translation = { kind: 'none' };
  } else {
    translation = { kind: 'engine', modelId: resolved.translation.modelId, ...localTranslationPrompt(context, s, shared) };
  }

  const config: LocalInferenceConfig = { asr, vad, translation };
  if (shared.segmentation.mode === 'sentences') config.jobSentences = shared.segmentation.sentencesPerRow;
  if (context.speech && resolved.tts) config.tts = localTts(context.direction, s, resolved.tts.modelId);
  else if (context.speech) config.ttsUnavailable = ttsMissingCode(context.direction, shared);
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

/**
 * Whether these models fit: VRAM only when its budget is set via localStorage (no API reports GPU memory), RAM always.
 * `deviceFeatures`: the GPU's, which pick the variant of a model that loads (`LocalModels.deviceFeatures`).
 */
export function fitsBudget(modelIds: string[], deviceFeatures: readonly string[]): boolean {
  const { vramMb, ramMb } = estimateModelMemoryByDevice(modelIds, [...deviceFeatures]);
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
export function admitLocalInference(configs: Partial<Record<LegName, LocalInferenceConfig>>, deviceFeatures: readonly string[]): true | ProviderRefusal | AdmittedConfigs<LocalInferenceConfig> {
  if (fitsBudget(modelIdsOf(configs), deviceFeatures)) return true;
  const refusal: ProviderRefusal = { refused: 'The models need more memory than this device has.', code: 'memory_exceeded' };
  const { participant } = configs;
  if (!participant?.tts) return refusal;
  const textOnly: LocalInferenceConfig = { ...participant, ttsUnavailable: 'participant_tts_over_budget' };
  delete textOnly.tts;
  if (!fitsBudget(modelIdsOf({ ...configs, participant: textOnly }), deviceFeatures)) return refusal;
  return { configs: { participant: textOnly } };
}
