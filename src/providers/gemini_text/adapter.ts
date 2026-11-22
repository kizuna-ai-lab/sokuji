// src/providers/gemini_text/adapter.ts
//
// The session side of Gemini's text models, through Gemini's OpenAI-compatible endpoint: a session that translates
// what another unit heard, one chat completion per stretch (`src/lib/textModel/translation.ts`). The provider's
// definition, its check and its options are the settings side (`provider.ts`).
import type { TranslationEvents, TranslationSession, TranslationStartRequest } from '../../lib/contract/translation';
import { startTextModelTranslation, type TextModelCredentials, type TextModelSessionDeps, type TextModelTranslationConfig } from '../../lib/textModel/translation';

export type GeminiTextConfig = TextModelTranslationConfig;
export type GeminiTextCredentials = TextModelCredentials;

/** One leg's translation session on Gemini's text models; `deps.transport` is a test's fake. */
export function createGeminiTextTranslation(deps: TextModelSessionDeps = {}) {
  return (request: TranslationStartRequest<GeminiTextConfig, GeminiTextCredentials>, events: TranslationEvents): TranslationSession =>
    startTextModelTranslation('gemini', deps, request, events);
}

export const startGeminiTextTranslation = createGeminiTextTranslation();
