// src/providers/openai_compatible/provider.ts
//
// A service that speaks OpenAI's chat-completions protocol (OpenRouter, DeepSeek, a local Ollama or LM Studio…),
// translating what another provider heard (spec 2026-11-22 §2, §4, §8): one unit, translation alone, at the address
// the user enters, with a key when the service needs one. Its requests are sent from the desktop app's main process
// (a third-party server need not answer the packaged page's CORS), so it is offered in the desktop app only, and
// refused without a request anywhere else. Its options are the translation's model and reasoning; it may list no
// model, and then the model is typed. For it the lowest reasoning means none is sent (its models are unknown).
import { Plug } from 'lucide-react';
import { textModelSettingsView } from '../../components/providers/TextModelSettings';
import { TL } from '../../lib/lineup/types';
import type { UnitDefinition } from '../../lib/run/types';
import type { CredentialsMissing, Provider } from '../../lib/provider/types';
import { compatibleAddressProblem } from '../../lib/textModel/address';
import { createTextModelCheck, type TextModelCheckDeps } from '../../lib/textModel/check';
import { ADDRESS_WORDS } from '../../lib/textModel/client';
import { textModelLanguages } from '../../lib/textModel/languages';
import type { TextModelSessionDeps } from '../../lib/textModel/translation';
import {
  migrateTextModelSettings, textModelTranslationUnit, TEXT_MODEL_CHECK_READS, TEXT_MODEL_DEFAULTS,
  type TextModelSettings,
} from '../../lib/textModel/unit';
import { createCompatibleTextTranslation, type CompatibleTextConfig, type CompatibleTextCredentials } from './adapter';

export const OPENAI_COMPATIBLE = 'openai_compatible';
/** No address entered: said where the key would be, in Accounts and keys. */
export const ADDRESS_MISSING = 'address_missing';
/** An address that cannot be used (not https off this computer, a name and password in it…), in the client's words. */
export const ADDRESS_INVALID = 'address_invalid';

/** Its one unit, its session over `deps.transport` (a test's fake) or the desktop app's main process. */
export function createCompatibleTextUnit(deps: TextModelSessionDeps = {}): UnitDefinition<TextModelSettings, CompatibleTextCredentials, CompatibleTextConfig> {
  return textModelTranslationUnit('compatible', createCompatibleTextTranslation(deps));
}

/** Its readiness: the service's models (none is no failure), and the chosen model asked once with the chosen reasoning. */
export function createCompatibleTextCheck(deps: TextModelCheckDeps = {}) {
  return createTextModelCheck(OPENAI_COMPATIBLE, 'compatible', 'The compatible service', deps);
}

export const openaiCompatibleProvider: Provider<TextModelSettings, CompatibleTextCredentials, CompatibleTextConfig> & { id: 'openai_compatible' } = {
  id: 'openai_compatible',
  kind: 'own-key',
  platforms: ['electron'],
  icon: Plug,

  // Not `openaiCompatible`: that prefix is the retired OpenAI Compatible's (its endpoint, its key), which nothing here
  // should read or send to the address entered now.
  settings: { key: 'compatibleText', defaults: TEXT_MODEL_DEFAULTS, migrate: migrateTextModelSettings },
  Settings: textModelSettingsView('compatible'),
  settingsStages: [TL],

  credentials: {
    keys: ['baseUrl', 'apiKey'],
    fields: () => [
      { key: 'baseUrl', labelKey: 'setup.credentials.baseUrl', secret: false, placeholderKey: 'setup.credentials.baseUrlPlaceholder' },
      { key: 'apiKey', labelKey: 'setup.credentials.apiKeyOptional', secret: true, placeholderKey: 'setup.credentials.apiKeyOptional', optional: true },
    ],
    read: (values): CompatibleTextCredentials | CredentialsMissing => {
      const baseUrl = (values.baseUrl ?? '').trim();
      if (baseUrl === '') return { missing: ADDRESS_WORDS.missing, code: ADDRESS_MISSING };
      const problem = compatibleAddressProblem(baseUrl);
      if (problem) return { missing: ADDRESS_WORDS[problem], code: ADDRESS_INVALID };
      const apiKey = (values.apiKey ?? '').trim();
      return apiKey ? { baseUrl, apiKey } : { baseUrl };
    },
  },
  check: createCompatibleTextCheck(),
  // The address and the key are credentials: a change of either checks again by itself.
  checkReads: TEXT_MODEL_CHECK_READS,

  languages: textModelLanguages,

  units: [createCompatibleTextUnit()],
};
