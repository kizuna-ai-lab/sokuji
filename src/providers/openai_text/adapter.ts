// src/providers/openai_text/adapter.ts
//
// The session side of OpenAI's text models: a session that translates what another unit heard, one chat completion
// per stretch (`src/lib/textModel/translation.ts`). The provider's definition, its check and its options are the
// settings side (`provider.ts`).
import type { TranslationEvents, TranslationSession, TranslationStartRequest } from '../../lib/contract/translation';
import { startTextModelTranslation, type TextModelCredentials, type TextModelSessionDeps, type TextModelTranslationConfig } from '../../lib/textModel/translation';

export type OpenAITextConfig = TextModelTranslationConfig;
export type OpenAITextCredentials = TextModelCredentials;

/** One leg's translation session on OpenAI's text models; `deps.transport` is a test's fake. */
export function createOpenAITextTranslation(deps: TextModelSessionDeps = {}) {
  return (request: TranslationStartRequest<OpenAITextConfig, OpenAITextCredentials>, events: TranslationEvents): TranslationSession =>
    startTextModelTranslation('openai', deps, request, events);
}

export const startOpenAITextTranslation = createOpenAITextTranslation();
