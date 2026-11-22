// src/providers/openai_compatible/adapter.ts
//
// The session side of a compatible service (one that speaks OpenAI's chat-completions protocol, at the address the
// user enters, asked from the desktop app's main process): a session that translates what another unit heard, one
// chat completion per stretch (`src/lib/textModel/translation.ts`). The provider's definition, its check and its
// options are the settings side (`provider.ts`).
import type { TranslationEvents, TranslationSession, TranslationStartRequest } from '../../lib/contract/translation';
import { startTextModelTranslation, type TextModelCredentials, type TextModelSessionDeps, type TextModelTranslationConfig } from '../../lib/textModel/translation';

export type CompatibleTextConfig = TextModelTranslationConfig;
export type CompatibleTextCredentials = TextModelCredentials;

/** One leg's translation session on a compatible service; `deps.transport` is a test's fake. */
export function createCompatibleTextTranslation(deps: TextModelSessionDeps = {}) {
  return (request: TranslationStartRequest<CompatibleTextConfig, CompatibleTextCredentials>, events: TranslationEvents): TranslationSession =>
    startTextModelTranslation('compatible', deps, request, events);
}

export const startCompatibleTextTranslation = createCompatibleTextTranslation();
