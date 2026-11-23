/**
 * Bing Translator as a unit that only translates: another provider's unit hears, Bing translates what it heard.
 * The session is the shared engine-backed one (`startLocalTranslation`); this file is its definition: what it
 * declares, which pairs it takes, and the config it builds (the model that is Bing, told nothing).
 */
import { TL } from '../../lib/lineup/types';
import { BING_TRANSLATOR, localTranslationRefusal, startLocalTranslation, type LocalTranslationConfig } from '../../lib/local-inference/sessions/translationSession';
import { TranslationEngine } from '../../lib/local-inference/engine/TranslationEngine';
import { sameStages } from '../../lib/plan/types';
import type { ProviderRefusal, UnitDefinition } from '../../lib/run/types';
import { bingTranslates } from './languages';

/** Bing has no settings of its own. */
export type BingSettings = Record<string, never>;
/** Bing has no credentials. */
export type BingCredentials = Record<string, never>;

/** Translation, and only when asked for exactly that. */
export const bingTranslationUnit: UnitDefinition<BingSettings, BingCredentials, LocalTranslationConfig> = {
  id: 'translation',
  occupies: (_s, want) => (sameStages(TL, want) ? TL : null),
  capabilities: () => ({
    speech: 'never',
    turns: ['auto', 'manual'],
    turnOwner: 'either',
    boundaries: 'provider',
    textInput: false,
    // One direction per session: a connection that carries both directions has no translator here.
    faceToFace: false,
    participantSpeech: true,
    translates: bingTranslates,
  }),
  build: (context): LocalTranslationConfig | ProviderRefusal => {
    const { source, target } = context.direction;
    const refusal = localTranslationRefusal(BING_TRANSLATOR, source, target);
    if (refusal !== null) return { refused: refusal };
    return { modelId: BING_TRANSLATOR, instructions: '', wrapTranscript: false };
  },
  describe: () => ({ translationModel: 'bing-translator' }),
  startTranslation: (request, events) => startLocalTranslation(() => new TranslationEngine(), request, events),
};
