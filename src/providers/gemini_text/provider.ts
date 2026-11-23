// src/providers/gemini_text/provider.ts
//
// Gemini's text models translating what another provider heard (spec 2026-11-22 §2, §4), through Gemini's
// OpenAI-compatible endpoint: one unit, translation alone, on the Gemini key the user already entered for Gemini Live
// (`storedAt`). Its options are the translation's model and reasoning, on the line-up's Translation card. The desktop
// app only (spec §1).
import { GeminiIcon } from '../../components/Icons/ProviderIcons';
import { textModelSettingsView } from '../../components/providers/TextModelSettings';
import { TL } from '../../lib/lineup/types';
import type { UnitDefinition } from '../../lib/run/types';
import type { CredentialsMissing, Provider } from '../../lib/provider/types';
import { createTextModelCheck, type TextModelCheckDeps } from '../../lib/textModel/check';
import { textModelLanguages } from '../../lib/textModel/languages';
import type { TextModelSessionDeps } from '../../lib/textModel/translation';
import {
  migrateTextModelSettings, textModelTranslationUnit, TEXT_MODEL_CHECK_READS, TEXT_MODEL_DEFAULTS,
  type TextModelSettings,
} from '../../lib/textModel/unit';
import { GEMINI_KEY_STORED_AT } from '../geminiKey';
import { createGeminiTextTranslation, type GeminiTextConfig, type GeminiTextCredentials } from './adapter';

export const GEMINI_TEXT = 'gemini_text';

/** Its one unit, its session over `deps.transport` (a test's fake) or the page's own. */
export function createGeminiTextUnit(deps: TextModelSessionDeps = {}): UnitDefinition<TextModelSettings, GeminiTextCredentials, GeminiTextConfig> {
  return textModelTranslationUnit('gemini', createGeminiTextTranslation(deps));
}

/** Its readiness: the key's text models, and the chosen model asked once with the chosen reasoning. */
export function createGeminiTextCheck(deps: TextModelCheckDeps = {}) {
  return createTextModelCheck(GEMINI_TEXT, 'gemini', 'Gemini', deps);
}

export const geminiTextProvider: Provider<TextModelSettings, GeminiTextCredentials, GeminiTextConfig> & { id: 'gemini_text' } = {
  id: 'gemini_text',
  kind: 'own-key',
  platforms: ['electron'],
  icon: GeminiIcon,
  // The Gemini setup guide: the same key.
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/gemini-setup',

  settings: { key: 'geminiText', defaults: TEXT_MODEL_DEFAULTS, migrate: migrateTextModelSettings },
  Settings: textModelSettingsView('gemini'),
  settingsStages: [TL],

  credentials: {
    keys: ['apiKey'],
    fields: () => [{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }],
    read: (values): GeminiTextCredentials | CredentialsMissing => {
      const apiKey = (values.apiKey ?? '').trim();
      return apiKey ? { apiKey } : { missing: 'Enter your Gemini API key.' };
    },
    // One Gemini key for Gemini Live and Gemini's text models (spec 2026-11-22 §2).
    storedAt: GEMINI_KEY_STORED_AT,
  },
  check: createGeminiTextCheck(),
  checkReads: TEXT_MODEL_CHECK_READS,

  languages: textModelLanguages,

  units: [createGeminiTextUnit()],
};
