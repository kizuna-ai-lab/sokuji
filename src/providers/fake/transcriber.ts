/**
 * The fake transcriber: a provider that only transcribes, so a plan whose
 * transcription and translation are separate units runs without a vendor.
 * Its one unit is the fake's adapter over a script of source segments alone:
 * text that grows, a stable start where the script states one, a close.
 * Development and E2E builds only, like the fake; nothing here runs at module
 * scope.
 */
import { Ear } from 'lucide-react';
import { AdapterStartError } from '../../lib/contract/adapter';
import { TR } from '../../lib/lineup/types';
import { sameStages } from '../../lib/plan/types';
import type { UnitDefinition } from '../../lib/plan/types';
import type { CredentialsMissing, Provider } from '../../lib/provider/types';
import type { FakeConfig } from './adapter';
import { FAKE_LANGUAGES, startFake } from './provider';
import { utterance, type FakeScript } from './script';

export type FakeTranscriptName = 'talk' | 'reconnect';
export const FAKE_TRANSCRIPT_NAMES: readonly FakeTranscriptName[] = ['talk', 'reconnect'];

/** Which script plays. */
export interface FakeTranscriberSettings { script: FakeTranscriptName }
export const FAKE_TRANSCRIBER_DEFAULTS: FakeTranscriberSettings = { script: 'talk' };
/** Nothing to enter. */
export type FakeTranscriberCredentials = Record<string, never>;

/** What was stored, made valid: an unknown script falls back to the default. */
export function migrateFakeTranscriberSettings(stored: Readonly<Record<string, unknown>>): FakeTranscriberSettings {
  const script = stored.script;
  return { script: FAKE_TRANSCRIPT_NAMES.includes(script as FakeTranscriptName) ? (script as FakeTranscriptName) : FAKE_TRANSCRIBER_DEFAULTS.script };
}

/** The scripts the fake transcriber can play: source segments only. */
export function fakeTranscript(name: FakeTranscriptName): FakeScript {
  switch (name) {
    case 'talk':
      return {
        blocks: [
          // Its first sentence becomes stable while the utterance goes on: it can be translated before the close.
          utterance({ startAt: 500, ref: 1, origin: 'h1', source: ['Hello', ['Hello. How are', 10], ['Hello. How are you today?', 10]] }),
          // Nothing of it is said to be stable: it is translated whole, at its close.
          utterance({ startAt: 5000, ref: 2, origin: 'h2', source: ['I am fine', 'I am fine, thank you.'] }),
        ],
      };
    case 'reconnect':
      // The connection drops with a source open, which closes as it stands; the unit comes back and goes on.
      return {
        blocks: [
          {
            startAt: 500,
            steps: [
              { at: 0, open: { ref: 1, side: 'source', origin: 'd1' } },
              { at: 200, text: { ref: 1, text: 'Before the drop. And then', heard: { pieces: [], stableLen: 20 } } },
              { at: 1000, reconnecting: true },
              { at: 1000, close: { ref: 1, origin: 'd1' } },
              { at: 2500, reconnected: true },
            ],
          },
          utterance({ startAt: 5000, ref: 2, origin: 'd2', source: ['Back again.'] }),
        ],
      };
  }
}

/** One leg's config: the script, and typed text shown as a source alone. */
export const buildFakeTranscriber = (_context: unknown, s: FakeTranscriberSettings): FakeConfig => ({ script: fakeTranscript(s.script), sourceOnly: true });

const describeFakeTranscriber = () => ({ asrModel: 'fake-transcriber' });

/** The fake transcriber's one unit: transcription, and only when asked for exactly that. */
const transcriberUnit: UnitDefinition<FakeTranscriberSettings, FakeTranscriberCredentials, FakeConfig> = {
  id: 'transcriber',
  occupies: (_s, want) => (sameStages(TR, want) ? TR : null),
  capabilities: () => ({
    speech: 'never',
    turns: ['auto', 'manual'],
    turnOwner: 'either',
    boundaries: 'provider',
    // Typed text is the transcription's: it is shown as a source, and whoever translates answers it.
    textInput: true,
    faceToFace: false,
    participantSpeech: true,
  }),
  build: buildFakeTranscriber,
  describe: describeFakeTranscriber,
  start: startFake,
};

/**
 * The fake transcriber provider: no key, always ready, the fake's languages. It never runs a session whole:
 * generic code reads its `units`, and its own `start` rejects.
 */
export const fakeTranscriberProvider: Provider<FakeTranscriberSettings, FakeTranscriberCredentials, FakeConfig> & { id: 'fake_transcriber' } = {
  id: 'fake_transcriber',
  kind: 'own-key',
  platforms: ['electron', 'extension', 'web'],
  icon: Ear,
  vendor: 'Sokuji',

  settings: { key: 'fakeTranscriber', defaults: FAKE_TRANSCRIBER_DEFAULTS, migrate: migrateFakeTranscriberSettings },
  Settings: () => null,

  credentials: {
    keys: [],
    fields: () => [],
    // Annotated: an inferred return would not be told from a `missing` answer.
    read: (): FakeTranscriberCredentials | CredentialsMissing => ({}),
  },
  check: async () => ({ ok: true }),

  languages: FAKE_LANGUAGES,

  speech: 'never',
  textInput: () => true,
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: buildFakeTranscriber,
  describe: describeFakeTranscriber,
  start: () => Promise.reject(new AdapterStartError('The fake transcriber only transcribes: it starts through its unit, beside a unit that translates.', 'plan_unsupported')),

  units: [transcriberUnit],
};
