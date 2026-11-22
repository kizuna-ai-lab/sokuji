/**
 * Bing Translator as a provider of its own: online, free, nothing to set up. Its one unit translates what another
 * provider's unit heard; it never runs a session whole.
 */
import { BingIcon } from '../../components/Icons/ProviderIcons';
import { AdapterStartError } from '../../lib/contract/adapter';
import { identityWire } from '../../lib/language/wire';
import type { LocalTranslationConfig } from '../../lib/local-inference/sessions/translationSession';
import type { CredentialsMissing, Provider } from '../../lib/provider/types';
import { bingLanguages, bingTranslates } from './languages';
import { bingTranslationUnit, type BingCredentials, type BingSettings } from './unit';

export type { BingCredentials, BingSettings };

const optionsOf = () => bingLanguages().map((value) => ({ value }));

export const bingProvider: Provider<BingSettings, BingCredentials, LocalTranslationConfig> & { id: 'bing' } = {
  id: 'bing',
  kind: 'online',
  platforms: ['electron', 'extension', 'web'],
  icon: BingIcon,

  settings: { key: 'bing', defaults: {} },
  Settings: () => null,
  // No options: nothing of it acts on any stage, so its card in the line-up has no fold.
  settingsStages: [],

  credentials: {
    keys: [],
    fields: () => [],
    // Annotated: an inferred return would not be told from a `missing` answer.
    read: (): BingCredentials | CredentialsMissing => ({}),
  },
  check: async () => ({ ok: true }),

  languages: {
    sources: optionsOf,
    targets: (source) => optionsOf().filter((o) => bingTranslates(source, o.value)),
    wire: identityWire(),
  },

  speech: 'never',
  textInput: () => false,
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: bingTranslationUnit.build,
  describe: bingTranslationUnit.describe,
  start: () => Promise.reject(new AdapterStartError('Bing only translates: it starts through its translation unit.', 'plan_unsupported')),

  units: [bingTranslationUnit],
};
