/**
 * The fake translator: a provider that only translates, so a plan whose
 * transcription and translation are separate units runs without a vendor.
 * Its one unit is a translator that is asked and answers (`jobTranslator`):
 * each stretch of source comes back marked with the language it was put
 * into, after a delay on the request's clock, and its settings make a job
 * fail or the unit die. Development and E2E builds only, like the fake;
 * nothing here runs at module scope. The session itself runs in
 * `translatorSession.ts`, the session side; this file is the unit and the
 * provider.
 */
import { Languages } from 'lucide-react';
import { TL } from '../../lib/lineup/types';
import { sameStages } from '../../lib/plan/types';
import type { UnitDefinition } from '../../lib/run/types';
import type { CredentialsMissing, Provider } from '../../lib/provider/types';
import { FAKE_LANGUAGES } from './provider';
import { startFakeTranslator, type FakeTranslatorConfig, type FakeTranslatorCredentials, type FakeTranslatorSettings } from './translatorSession';

export { startFakeTranslator };
export type { FakeTranslatorConfig, FakeTranslatorCredentials, FakeTranslatorSettings };

export const FAKE_TRANSLATOR_DEFAULTS: FakeTranslatorSettings = { delayMs: 0, failOn: '', dieOn: '' };

/** What was stored, made valid: a bad delay or a word that is no text falls back to its default. */
export function migrateFakeTranslatorSettings(stored: Readonly<Record<string, unknown>>): FakeTranslatorSettings {
  const word = (key: 'failOn' | 'dieOn'): string => {
    const value = stored[key];
    return typeof value === 'string' ? value : FAKE_TRANSLATOR_DEFAULTS[key];
  };
  const { delayMs } = stored;
  return { delayMs: typeof delayMs === 'number' && Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : FAKE_TRANSLATOR_DEFAULTS.delayMs, failOn: word('failOn'), dieOn: word('dieOn') };
}

/** The languages the fake translates between. */
const TRANSLATED = new Set(['en', 'ja', 'zh']);

const describeFakeTranslator = () => ({ translationModel: 'fake-translator' });

/** The fake translator's one unit: translation, and only when asked for exactly that. */
const translatorUnit: UnitDefinition<FakeTranslatorSettings, FakeTranslatorCredentials, FakeTranslatorConfig> = {
  id: 'translator',
  occupies: (_s, want) => (sameStages(TL, want) ? TL : null),
  capabilities: () => ({
    speech: 'never',
    turns: ['auto', 'manual'],
    turnOwner: 'either',
    boundaries: 'provider',
    textInput: false,
    faceToFace: false,
    participantSpeech: true,
    // A fixed pair of its languages: a source that is not known yet has nothing to translate from.
    translates: (source, target) => source !== target && TRANSLATED.has(source) && TRANSLATED.has(target),
  }),
  build: (_context, s) => ({ ...s }),
  describe: describeFakeTranslator,
  startTranslation: startFakeTranslator,
};

/**
 * The fake translator provider: no key, always ready, the fake's languages. It never runs a session whole: it
 * starts through its unit.
 */
export const fakeTranslatorProvider: Provider<FakeTranslatorSettings, FakeTranslatorCredentials, FakeTranslatorConfig> & { id: 'fake_translator' } = {
  id: 'fake_translator',
  kind: 'own-key',
  platforms: ['electron', 'extension', 'web'],
  icon: Languages,
  vendor: 'Sokuji',

  settings: { key: 'fakeTranslator', defaults: FAKE_TRANSLATOR_DEFAULTS, migrate: migrateFakeTranslatorSettings },
  Settings: () => null,

  credentials: {
    keys: [],
    fields: () => [],
    // Annotated: an inferred return would not be told from a `missing` answer.
    read: (): FakeTranslatorCredentials | CredentialsMissing => ({}),
  },
  check: async () => ({ ok: true }),

  languages: FAKE_LANGUAGES,

  units: [translatorUnit],
};
