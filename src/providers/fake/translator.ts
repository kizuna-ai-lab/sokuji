/**
 * The fake translator: a provider that only translates, so a plan whose
 * transcription and translation are separate units runs without a vendor.
 * Its one unit is a translator that is asked and answers (`jobTranslator`):
 * each stretch of source comes back marked with the language it was put
 * into, after a delay on the request's clock, and its settings make a job
 * fail or the unit die. Development and E2E builds only, like the fake;
 * nothing here runs at module scope.
 */
import { Languages } from 'lucide-react';
import { AdapterStartError } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import type { TranslationEvents, TranslationSession, TranslationStartRequest } from '../../lib/contract/translation';
import { TL } from '../../lib/lineup/types';
import { sameStages } from '../../lib/plan/types';
import type { UnitDefinition } from '../../lib/plan/types';
import type { CredentialsMissing, Provider } from '../../lib/provider/types';
import { createJobTranslator } from '../../lib/translation/jobTranslator';
import { FAKE_LANGUAGES } from './provider';

/** The fault knobs. */
export interface FakeTranslatorSettings {
  /** Each answer comes this long after it was asked, in ms. */
  delayMs: number;
  /** A stretch that holds this word fails, and the next is translated; empty: none fails. */
  failOn: string;
  /** A stretch that holds this word is the unit's end; empty: it never dies. */
  dieOn: string;
}
export const FAKE_TRANSLATOR_DEFAULTS: FakeTranslatorSettings = { delayMs: 0, failOn: '', dieOn: '' };
/** Nothing to enter. */
export type FakeTranslatorCredentials = Record<string, never>;
export type FakeTranslatorConfig = FakeTranslatorSettings;

/** What was stored, made valid: a bad delay or a word that is no text falls back to its default. */
export function migrateFakeTranslatorSettings(stored: Readonly<Record<string, unknown>>): FakeTranslatorSettings {
  const word = (key: 'failOn' | 'dieOn'): string => {
    const value = stored[key];
    return typeof value === 'string' ? value : FAKE_TRANSLATOR_DEFAULTS[key];
  };
  const { delayMs } = stored;
  return { delayMs: typeof delayMs === 'number' && Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : FAKE_TRANSLATOR_DEFAULTS.delayMs, failOn: word('failOn'), dieOn: word('dieOn') };
}

/** The unit's end, as opposed to one job's failure. */
class FakeTranslatorGone extends Error {}

/** Resolves after `ms` on `clock`; rejects, and disarms its timer, when `signal` aborts first. */
function wait(clock: Clock, ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cancel = clock.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      cancel();
      reject(signal.reason ?? new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** The languages the fake translates between. */
const TRANSLATED = new Set(['en', 'ja', 'zh']);

/**
 * One session of the fake translator: a job translator whose answer is the stretch itself, marked with the leg's
 * target (`[ja] Hello.`), so a test reads which direction translated a row.
 */
export function startFakeTranslator(request: TranslationStartRequest<FakeTranslatorConfig, FakeTranslatorCredentials>, events: TranslationEvents): TranslationSession {
  const { clock, config, signal } = request;
  const { target } = request.context.direction;
  return createJobTranslator({
    events,
    clock,
    signal,
    language: target,
    fatal: (error) => error instanceof FakeTranslatorGone,
    async translate(text, job) {
      if (config.delayMs > 0) await wait(clock, config.delayMs, job);
      if (config.dieOn !== '' && text.includes(config.dieOn)) throw new FakeTranslatorGone('The fake translator is gone (fault knob).');
      if (config.failOn !== '' && text.includes(config.failOn)) throw new Error('The fake translator failed this sentence (fault knob).');
      return `[${target}] ${text}`;
    },
  });
}

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
 * The fake translator provider: no key, always ready, the fake's languages. It never runs a session whole: generic
 * code reads its `units`, and its own `start` rejects.
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

  speech: 'never',
  textInput: () => false,
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: (_context, s) => ({ ...s }),
  describe: describeFakeTranslator,
  start: () => Promise.reject(new AdapterStartError('The fake translator only translates: it starts through its translation unit.', 'plan_unsupported')),

  units: [translatorUnit],
};
