/**
 * Local Native's translation as a unit that only translates: a model in the local engine translating what another
 * provider's unit heard. Its config names the model for the leg's direction, what that model is told, and which
 * other models the line-up loads beside it; its session is `translationSession.ts`.
 *
 * A line-up in which Local Native transcribes and translates does not come here: it runs the whole session.
 */
import type { LegName } from '../../lib/conversation/types';
import { AUTO } from '../../lib/language/code';
import type { NativeModels } from '../../lib/local-inference/native/nativeModels';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import { TL } from '../../lib/lineup/types';
import { sameStages } from '../../lib/plan/types';
import type { ProviderRefusal, SharedSettings, UnitDefinition } from '../../lib/run/types';
import type { SessionContext } from '../../lib/contract/adapter';
import type { LocalNativeCredentials } from './adapter';
import { localInstructions, nativeModelsOf, oneSideAtATime } from './config';
import { nativeEngines, type LocalNativeEngines } from './engines';
import type { LocalNativeSettings } from './settings';
import { startNativeTranslation, type NativeTranslationConfig } from './translationSession';

export type NativeTranslationUnit = UnitDefinition<LocalNativeSettings, LocalNativeCredentials, NativeTranslationConfig>;

/**
 * Whether Local Native's translation takes a pair, as far as is known without its runtime catalog (#578 ruling 19):
 * a fixed source into another fixed language. Whether a model takes the pair is readiness's to say
 * (`native_translation_missing`).
 */
export function nativeTranslates(source: string, target: string): boolean {
  return source !== AUTO && target !== AUTO && source !== target;
}

/**
 * The other models the line-up loads in the engine beside this translation, resolved with the same selections, so the
 * engine counts them in its memory budget (#578 ruling 22). Counting one that does not load is safe.
 */
export function coLoadedOf(
  context: SessionContext,
  s: LocalNativeSettings,
  shared: Pick<SharedSettings, 'lineUp' | 'speaks'>,
  facts: NativeModels,
): { asrModel?: string; ttsModel?: string } {
  const lineUp = shared.lineUp;
  if (!lineUp) return {};
  const asrHere = lineUp.transcription === 'local_native';
  const ttsHere = lineUp.speech === 'local_native' && shared.speaks === true;
  if (!asrHere && !ttsHere) return {};
  const resolved = facts.resolve(context.direction.source, context.direction.target, s.selections);
  return {
    ...(asrHere && resolved.asr ? { asrModel: resolved.asr.modelId } : {}),
    ...(ttsHere && resolved.tts ? { ttsModel: resolved.tts.modelId } : {}),
  };
}

/** Local Native's translation unit: translation, and only when asked for exactly that. */
export function createNativeTranslationUnit(deps: { engines?: Pick<LocalNativeEngines, 'translation'> } = {}): NativeTranslationUnit {
  const engines = deps.engines ?? nativeEngines;
  return {
    id: 'translation',
    occupies: (_s, want) => (sameStages(TL, want) ? TL : null),
    capabilities: () => ({
      speech: 'never',
      turns: ['auto', 'manual'],
      boundaries: 'provider',
      textInput: false,
      // One direction per session: a connection that carries both directions has no translator here.
      faceToFace: false,
      participantSpeech: true,
      translates: nativeTranslates,
    }),
    build: (context, s, shared): NativeTranslationConfig | ProviderRefusal => {
      const { source, target } = context.direction;
      if (source === AUTO) return { refused: 'A translation in the local engine needs a fixed source language.' };
      const facts = nativeModelsOf(shared);
      const translation = facts.resolve(source, target, s.selections).translation;
      if (!translation) return { refused: `No translation model for ${source} → ${target}.`, code: 'native_translation_missing' };
      const instructions = localInstructions(context, s, shared);
      const wrapTranscript = s.useTemplateMode
        || instructions === buildDefaultLocalPrompt(source, target)
        || instructions === buildDefaultLocalPrompt(target, source);
      return {
        modelId: translation.modelId,
        ...(translation.variant ? { variant: translation.variant } : {}),
        device: s.translationDevice,
        instructions,
        wrapTranscript,
        coLoaded: coLoadedOf(context, s, shared, facts),
        host: facts,
      };
    },
    describe: (c) => ({ translationModel: c.modelId }),
    startTranslation: (request, events) => startNativeTranslation((clock) => engines.translation(clock), request, events),
  };
}

export const nativeTranslationUnit: NativeTranslationUnit = createNativeTranslationUnit();

/** Whether one leg's config is this unit's, told by its shape: it carries a prompt and co-loaded ids, and names no recognition model. */
function isNativeTranslationConfig(config: unknown): config is NativeTranslationConfig {
  return typeof config === 'object' && config !== null && 'instructions' in config && 'coLoaded' in config && !('asr' in config);
}

/** Whether the configs a provider's `admit` was handed are this unit's: some leg has one, and every one given is one. */
export function areNativeTranslationConfigs(configs: Partial<Record<LegName, unknown>>): configs is Partial<Record<LegName, NativeTranslationConfig>> {
  const given = Object.values(configs).filter((c) => c !== undefined && c !== null);
  return given.length > 0 && given.every(isNativeTranslationConfig);
}

/** Local Native's translation runs one side at a time (#578 ruling 4). */
export function admitNativeTranslation(configs: Partial<Record<LegName, NativeTranslationConfig>>): true | ProviderRefusal {
  return oneSideAtATime(configs, "Local Native's translation runs one side at a time: choose Me or Other.");
}
