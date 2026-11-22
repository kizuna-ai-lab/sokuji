// src/lib/textModel/unit.ts
//
// What the three text-model providers share (spec §2, §4): their settings, the translation unit (it occupies exactly
// `translation`), its config and what it describes. Each provider's folder holds its own definition, its key or
// address, and its `adapter.ts`, which starts the session (`translation.ts`); no provider imports another's folder,
// so the shared parts live here.

import type { SessionContext } from '../contract/adapter';
import { TL } from '../lineup/types';
import { sameStages, type UnitCapabilities, type UnitDefinition } from '../plan/types';
import type { ProviderRefusal, SharedSettings } from '../provider/types';
import type { TextModelService } from './client';
import {
  maxTokensFor, modelChoiceOf, modelToUse, reasoningAskOf, reasoningChoiceOf, translationTemperature, DEFAULT_MODEL_CHOICE, DEFAULT_NOTES_REASONING_CHOICE,
  DEFAULT_REASONING_CHOICE,
} from './choice';
import type { TextModelStageSettings } from './check';
import { TEXT_MODEL_UNSET } from './check';
import { textModelTranslates } from './languages';
import { textModelIds } from './models';
import { translationSystemPrompt } from './prompt';
import type { TextModelCredentials, TextModelTranslationConfig } from './translation';

/**
 * A text-model provider's settings: per stage, the model and the reasoning (each chosen from a list, or typed): the
 * translation's, and the notes' (text models, part C), whose reasoning is Medium by default.
 */
export type TextModelSettings = TextModelStageSettings;

export const TEXT_MODEL_DEFAULTS: TextModelSettings = {
  translationModel: DEFAULT_MODEL_CHOICE,
  translationReasoning: DEFAULT_REASONING_CHOICE,
  notesModel: DEFAULT_MODEL_CHOICE,
  notesReasoning: DEFAULT_NOTES_REASONING_CHOICE,
};

/** What was stored, made valid field by field. */
export function migrateTextModelSettings(stored: Readonly<Record<string, unknown>>): TextModelSettings {
  return {
    translationModel: modelChoiceOf(stored.translationModel),
    translationReasoning: reasoningChoiceOf(stored.translationReasoning),
    notesModel: modelChoiceOf(stored.notesModel),
    notesReasoning: reasoningChoiceOf(stored.notesReasoning, DEFAULT_NOTES_REASONING_CHOICE),
  };
}

/**
 * The fields the run's check reads: a change of the translation's model or reasoning checks again. Not the notes':
 * notes are not a run stage, and the Notes card keeps its own answers, keyed on the notes' choices
 * (`components/SettingsPage/notesReadiness.ts`), so a notes edit never makes Start wait. The key and the address are
 * credentials.
 */
export const TEXT_MODEL_CHECK_READS = ['translationModel', 'translationReasoning'] as const;

/** A text model translates, and does nothing else a session asks of a unit. */
export const TEXT_MODEL_CAPABILITIES: UnitCapabilities = {
  speech: 'never',
  turns: ['auto', 'manual'],
  turnOwner: 'either',
  boundaries: 'provider',
  textInput: false,
  // One direction per session: a connection that hears both people has no translator here.
  faceToFace: false,
  participantSpeech: true,
  translates: textModelTranslates,
};

/**
 * One leg's config: the model the check found usable (the typed name, the one chosen, else the service's default
 * among the models the run's check listed), the reasoning as chosen, the system prompt for the leg's direction with
 * the word list, and the answer's budget. Refused when no model can be named.
 */
export function buildTextModelTranslation(service: TextModelService, context: SessionContext, s: TextModelSettings, shared: SharedSettings): TextModelTranslationConfig | ProviderRefusal {
  const { source, target } = context.direction;
  if (!textModelTranslates(source, target)) return { refused: `A text model does not translate ${source} into ${target}.` };
  const model = modelToUse(service, s.translationModel, textModelIds(service, shared.models.map((m) => m.id)));
  if (model === null) return { refused: 'No model is chosen: choose one, or type its name.', code: TEXT_MODEL_UNSET };
  const reasoning = reasoningAskOf(s.translationReasoning);
  const temperature = translationTemperature(service, model);
  return {
    model,
    reasoning,
    system: translationSystemPrompt(context.direction, shared.words),
    maxTokens: maxTokensFor(service, model, reasoning),
    ...(temperature === undefined ? {} : { temperature }),
  };
}

export const describeTextModelTranslation = (c: TextModelTranslationConfig) => ({ translationModel: c.model });

/** The unit of a text-model provider: translation, and only when asked for exactly that. */
export function textModelTranslationUnit(
  service: TextModelService,
  start: NonNullable<UnitDefinition<TextModelSettings, TextModelCredentials, TextModelTranslationConfig>['startTranslation']>,
): UnitDefinition<TextModelSettings, TextModelCredentials, TextModelTranslationConfig> {
  return {
    id: 'translation',
    occupies: (_s, want) => (sameStages(TL, want) ? TL : null),
    capabilities: () => TEXT_MODEL_CAPABILITIES,
    build: (context, s, shared) => buildTextModelTranslation(service, context, s, shared),
    describe: describeTextModelTranslation,
    startTranslation: start,
  };
}
