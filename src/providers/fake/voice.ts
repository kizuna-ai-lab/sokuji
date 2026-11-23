/**
 * The fake voice: a provider that only speaks, so a plan of a text unit and a
 * speech unit runs without a vendor. Its one unit reads each stretch of text
 * it is handed as silence, one clip per sentence, on the request's clock.
 * Development and E2E builds only, like the fake; nothing here runs at module
 * scope.
 */
import { Volume2 } from 'lucide-react';
import type { TextRange } from '../../lib/contract/adapter';
import type { SpeechEvents, SpeechSession, SpeechStartRequest } from '../../lib/contract/speech';
import { SP } from '../../lib/lineup/types';
import { sameStages } from '../../lib/plan/types';
import type { UnitDefinition } from '../../lib/run/types';
import type { CredentialsMissing, Provider } from '../../lib/provider/types';
import { FAKE_LANGUAGES } from './provider';

/** Nothing to set. */
export type FakeVoiceSettings = Record<string, never>;
/** Nothing to enter. */
export type FakeVoiceCredentials = Record<string, never>;
export interface FakeVoiceConfig { voice: 'fake' }

/** The samples of one clip: a tenth of a second at the contract's rate. */
const CLIP_SAMPLES = 2400;

/** A sentence up to its end marks and the spaces after them, or a last stretch with no end mark. */
const SENTENCE = /[^.!?。！？]*[.!?。！？]+\s*|[^.!?。！？]+$/g;

/** Where each sentence of `text` sits, without the spaces around it, counted from `offset`. A blank text has none. */
export function sentenceRanges(text: string, offset: number): TextRange[] {
  const ranges: TextRange[] = [];
  for (const match of text.matchAll(SENTENCE)) {
    const piece = match[0];
    const start = match.index + (piece.length - piece.trimStart().length);
    const end = match.index + piece.trimEnd().length;
    if (end > start) ranges.push([offset + start, offset + end]);
  }
  return ranges;
}

/**
 * One session of the fake voice. Each `speak` while speech is on is answered on the next tick of the request's
 * clock, never inside the call: one clip of silence per sentence, with the sentence's range in the row's whole
 * translation, counted on the request's counter before it is said. Switching speech off drops what waits; after
 * `close()` nothing is said.
 */
export function startFakeVoice(request: SpeechStartRequest<FakeVoiceConfig, FakeVoiceCredentials>, events: SpeechEvents): SpeechSession {
  const { clock, counts } = request;
  let on = true;
  let closed = false;
  /** The cancel of every answer still waiting for its tick. */
  const pending = new Set<() => void>();
  const drop = () => {
    for (const cancel of pending) cancel();
    pending.clear();
  };
  return {
    open: async () => {},
    speak(ref, text, span, _language, home) {
      if (!on || closed) return;
      const cancel = clock.setTimeout(() => {
        pending.delete(cancel);
        for (const range of sentenceRanges(text, span[0])) {
          // A listener may switch speech off or close the session between two clips.
          if (!on || closed) return;
          counts.set(ref, (counts.get(ref) ?? 0) + 1);
          events.audio({ pcm: new Int16Array(CLIP_SAMPLES), ref, range, ...(home ? { home } : {}) });
        }
      }, 0);
      pending.add(cancel);
    },
    endUtterance() {},
    setOn(next) {
      on = next;
      if (!next) drop();
    },
    close() {
      closed = true;
      drop();
    },
  };
}

/** The fake voice's one unit: speech, and only when asked for exactly that. */
const voiceUnit: UnitDefinition<FakeVoiceSettings, FakeVoiceCredentials, FakeVoiceConfig> = {
  id: 'voice',
  occupies: (_s, want) => (sameStages(SP, want) ? SP : null),
  capabilities: () => ({
    // The user's switch says whether a leg is read aloud: with 'always' a text-only session would be read anyway.
    speech: 'optional',
    turns: ['auto', 'manual'],
    turnOwner: 'either',
    boundaries: 'silence',
    textInput: false,
    faceToFace: true,
    participantSpeech: true,
    // It reads silence: every language.
    speaks: () => true,
  }),
  build: () => ({ voice: 'fake' }),
  describe: () => ({ ttsModel: 'fake-voice' }),
  startSpeech: startFakeVoice,
};

/**
 * The fake voice provider: no key, always ready, the fake's languages. It is never a text provider: it starts
 * through its unit.
 */
export const fakeVoiceProvider: Provider<FakeVoiceSettings, FakeVoiceCredentials, FakeVoiceConfig> & { id: 'fake_voice' } = {
  id: 'fake_voice',
  kind: 'own-key',
  platforms: ['electron', 'extension', 'web'],
  icon: Volume2,
  vendor: 'Sokuji',

  settings: { key: 'fakeVoice', defaults: {} },
  Settings: () => null,

  credentials: {
    keys: [],
    fields: () => [],
    // Annotated: an inferred return would not be told from a `missing` answer.
    read: (): FakeVoiceCredentials | CredentialsMissing => ({}),
  },
  check: async () => ({ ok: true }),

  languages: FAKE_LANGUAGES,

  units: [voiceUnit],
};
