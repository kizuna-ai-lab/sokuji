// src/providers/openai_text/provider.ts
//
// OpenAI's text models translating what another provider heard (spec 2026-11-22 §2, §4): one unit, translation
// alone, on the one OpenAI key the user already entered for Realtime, Translate and Live (`storedAt`). Its options are
// the translation's model and reasoning, on the line-up's Translation card. The desktop app only (spec §1).
import { OpenAIIcon } from '../../components/Icons/ProviderIcons';
import { textModelSettingsView } from '../../components/providers/TextModelSettings';
import { AdapterStartError } from '../../lib/contract/adapter';
import { TL } from '../../lib/lineup/types';
import type { UnitDefinition } from '../../lib/plan/types';
import { notesModelFromOld, OLD_NOTES_MODEL_KEY } from '../../lib/notes/oldNotesModel';
import type { CredentialsMissing, MigrationInputs, Provider } from '../../lib/provider/types';
import { createTextModelCheck, type TextModelCheckDeps } from '../../lib/textModel/check';
import { textModelLanguages } from '../../lib/textModel/languages';
import type { TextModelSessionDeps } from '../../lib/textModel/translation';
import {
  buildTextModelTranslation, describeTextModelTranslation, migrateTextModelSettings, textModelTranslationUnit, TEXT_MODEL_CHECK_READS, TEXT_MODEL_DEFAULTS,
  type TextModelSettings,
} from '../../lib/textModel/unit';
import { OPENAI_KEY_STORED_AT } from '../openaiKey';
import { createOpenAITextTranslation, type OpenAITextConfig, type OpenAITextCredentials } from './adapter';

export const OPENAI_TEXT = 'openai_text';

/** Its one unit, its session over `deps.transport` (a test's fake) or OpenAI's own. */
export function createOpenAITextUnit(deps: TextModelSessionDeps = {}): UnitDefinition<TextModelSettings, OpenAITextCredentials, OpenAITextConfig> {
  return textModelTranslationUnit('openai', createOpenAITextTranslation(deps));
}

/** The field of its own the notes model is kept in, read with no default to tell "never stored". */
const OWN_NOTES_MODEL = 'notesModel';

/**
 * Its settings as every text model's (`migrateTextModelSettings`), and the notes model the old global setting stood
 * for while it holds none of its own (text models, part C): the notes with the user's own OpenAI key are its now.
 */
export function migrateOpenAITextSettings(stored: Readonly<Record<string, unknown>>, inputs: MigrationInputs): TextModelSettings {
  const settings = migrateTextModelSettings(stored);
  if (inputs.legacy[OWN_NOTES_MODEL] !== undefined) return settings;
  return { ...settings, notesModel: notesModelFromOld(inputs.legacy[OLD_NOTES_MODEL_KEY]) };
}

/** Its readiness: the key's text models, and the chosen model asked once with the chosen reasoning. */
export function createOpenAITextCheck(deps: TextModelCheckDeps = {}) {
  return createTextModelCheck(OPENAI_TEXT, 'openai', 'OpenAI', deps);
}

export const openaiTextProvider: Provider<TextModelSettings, OpenAITextCredentials, OpenAITextConfig> & { id: 'openai_text' } = {
  id: 'openai_text',
  kind: 'own-key',
  platforms: ['electron'],
  icon: OpenAIIcon,
  // The OpenAI setup guide: the same key.
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',

  settings: { key: 'openaiText', defaults: TEXT_MODEL_DEFAULTS, legacyKeys: [OLD_NOTES_MODEL_KEY, OWN_NOTES_MODEL], migrate: migrateOpenAITextSettings },
  Settings: textModelSettingsView('openai'),
  optionStages: [TL],

  credentials: {
    keys: ['apiKey'],
    fields: () => [{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }],
    read: (values): OpenAITextCredentials | CredentialsMissing => {
      // Trimmed: a pasted trailing newline is no valid token.
      const apiKey = (values.apiKey ?? '').trim();
      return apiKey ? { apiKey } : { missing: 'Enter your OpenAI API key.' };
    },
    // One OpenAI key for every OpenAI provider (owner, 2026-11-15).
    storedAt: OPENAI_KEY_STORED_AT,
  },
  check: createOpenAITextCheck(),
  checkReads: TEXT_MODEL_CHECK_READS,

  languages: textModelLanguages,

  speech: 'never',
  textInput: () => false,
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: (context, s, shared) => buildTextModelTranslation('openai', context, s, shared),
  describe: describeTextModelTranslation,
  // It never runs a session whole: it translates another provider's transcription, through its unit.
  start: () => Promise.reject(new AdapterStartError("OpenAI's text models only translate: they start through their translation unit.", 'plan_unsupported')),

  units: [createOpenAITextUnit()],
};
