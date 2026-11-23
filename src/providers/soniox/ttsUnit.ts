/**
 * Soniox's voice as a unit that only speaks: one leg's `LegSpeech` behind
 * the speech contract. The unit is handed text with its row and span and
 * emits audio with the characters it reads; which text is read, by which
 * leg's voice, and where the audio goes are the caller's. `LegSpeech`
 * speaks through adapter events, one object per leg its audio belongs to;
 * here each is a view of the session's speech events that names that leg
 * as the audio's `home`.
 */
import type { AdapterEvents } from '../../lib/contract/adapter';
import type { SpeechEvents, SpeechSession, SpeechStartRequest } from '../../lib/contract/speech';
import type { LegName } from '../../lib/conversation/types';
import { SP } from '../../lib/lineup/types';
import { AUTO } from '../../lib/provider/languages';
import { sameStages } from '../../lib/plan/types';
import type { UnitDefinition } from '../../lib/run/types';
import { describeSonioxTts, sonioxTts, type SonioxTtsConfig } from './config';
import { sonioxWire } from './languages';
import type { SonioxSettings, SonioxVoiceCredentials } from './settings';
import { nativeSocket, type OpenSocket } from './socket';
import { LegSpeech, NO_TTS_KEY_MESSAGE } from './speech';

export interface SonioxTtsUnitDeps {
  /** `new WebSocket(url)` in the app; a `FakeSocket` factory in tests. */
  openSocket?: OpenSocket;
  /** False: the participant leg never speaks, whatever its switch says. Absent: it may. */
  participantSpeech?: boolean;
}

/** The unit's config: the leg's voice and speed. `off`: built for a leg that does not speak, which starts no voice and names no speech model. */
export type SonioxTtsUnitConfig = SonioxTtsConfig & { off?: true };

/** Its credentials are the voice's part of a leg's: an own key's and a session lease's carry it, a voice-only lease's are nothing else. */
export type SonioxTtsUnit = UnitDefinition<SonioxSettings, SonioxVoiceCredentials, SonioxTtsUnitConfig>;

/** The members of `AdapterEvents` a voice has no business calling. */
type NotSpeech = Exclude<keyof AdapterEvents, keyof SpeechEvents>;

/**
 * What `LegSpeech` speaks through, for audio that belongs to `home`'s rows (absent: the voice's own leg).
 * `LegSpeech` names itself as the `voice` of audio it reads for another leg; that is the caller's to say here,
 * so it is not passed on.
 */
function legEvents(events: SpeechEvents, home?: LegName): AdapterEvents {
  const at = home === undefined ? {} : { home };
  // `LegSpeech` calls none of these. One that did would be a programming error: said in the Logs, never dropped silently.
  const stray = (event: NotSpeech) => () => events.frame({ direction: 'in', type: 'tts.unexpected_event', payload: { event } });
  return {
    audio: ({ pcm, ref, range }) => {
      // `LegSpeech` emits no audio without a ref; the speech contract has no place for one.
      if (ref !== undefined) events.audio({ pcm, ref, ...(range ? { range } : {}), ...at });
    },
    speechRanges: ({ ref, ranges }) => events.speechRanges({ ref, ranges, ...at }),
    degraded: ({ code, message, cause, reason }) => events.degraded({ code, message, ...(cause === undefined ? {} : { cause }), ...(reason === undefined ? {} : { reason }) }),
    frame: (e) => events.frame(e),
    segmentOpened: stray('segmentOpened'),
    segmentText: stray('segmentText'),
    segmentClosed: stray('segmentClosed'),
    closed: stray('closed'),
    reconnecting: stray('reconnecting'),
    reconnected: stray('reconnected'),
    failed: stray('failed'),
    loading: stray('loading'),
    busy: stray('busy'),
  };
}

/** A leg asked to speak with no key for it: said once when it opens, and nothing else ever happens. */
function silentSession(events: SpeechEvents): SpeechSession {
  let said = false;
  let closed = false;
  return {
    open: async () => {
      if (said || closed) return;
      said = true;
      events.degraded({ code: 'tts_degraded', message: NO_TTS_KEY_MESSAGE });
    },
    speak() {},
    endUtterance() {},
    setOn() {},
    recycle() {},
    close() { closed = true; },
  };
}

function startSonioxSpeech(openSocket: OpenSocket, request: SpeechStartRequest<SonioxTtsUnitConfig, SonioxVoiceCredentials>, events: SpeechEvents): SpeechSession {
  const { config, credentials } = request;
  const key = credentials.tts;
  if (!key) return silentSession(events);
  const own = legEvents(events);
  const speech = new LegSpeech({
    leg: request.leg,
    counts: request.counts,
    region: credentials.region,
    key,
    clientReferenceId: credentials.clientReferenceId,
    voice: config.voice,
    speed: config.speed,
    events: own,
    clock: request.clock,
    openSocket,
    // A voice-only lease's port, the only one a voice reports to: with a session's lease the credentials carry none
    // (its port is `lease`, the transcription socket's, which reports the start itself), and an own key has none.
    ...(credentials.voiceLease ? { opened: () => credentials.voiceLease?.streamAccepted() } : {}),
  });
  /** One view per home leg: `LegSpeech` keeps the object it was handed for as long as the row is being read. */
  const homes = new Map<LegName, AdapterEvents>();
  const homeEvents = (home: LegName): AdapterEvents => {
    let view = homes.get(home);
    if (!view) {
      view = legEvents(events, home);
      homes.set(home, view);
    }
    return view;
  };
  let closed = false;
  return {
    open: () => speech.open(),
    speak(ref, text, span, language, home) {
      if (closed) return;
      let wire: string;
      try {
        wire = sonioxWire.toWire(language);
      } catch {
        // A language Soniox has no code for cannot be read. The caller's line-up check keeps it from getting here;
        // if one does, the chunk is left out and the Logs say so.
        own.frame({ direction: 'out', type: 'tts.language_unsupported', payload: { language } });
        return;
      }
      speech.speak(ref, text, span, wire, home === undefined ? undefined : homeEvents(home));
    },
    // One utterance is open at a time on a leg's voice: the row it belongs to needs no naming.
    endUtterance: () => speech.endUtterance(),
    setOn: (on) => speech.setOn(on),
    recycle: () => speech.recycle(),
    close() {
      closed = true;
      speech.close();
    },
  };
}

/** Whether Soniox's voice reads `language`: the languages its table has a code for, which `speak` sends. */
export function sonioxSpeaks(language: string): boolean {
  if (language === AUTO) return false;
  try {
    sonioxWire.toWire(language);
    return true;
  } catch {
    return false;
  }
}

/**
 * Soniox's speech unit: speech, and only when asked for exactly that. Its config is the leg's voice and speed
 * (`sonioxTts`); its key is the credentials' `tts`. Under a voice-only lease it reports its start through the
 * credentials' `voiceLease`, once its connection first opens.
 */
export function createSonioxTtsUnit(deps: SonioxTtsUnitDeps = {}): SonioxTtsUnit {
  const openSocket = deps.openSocket ?? nativeSocket;
  const participantSpeech = deps.participantSpeech !== false;
  return {
    id: 'tts',
    occupies: (_s, want) => (sameStages(SP, want) ? SP : null),
    capabilities: () => ({
      // Whether a leg is read aloud is the user's switch to say, as it is for Soniox as a whole.
      speech: 'optional',
      turns: ['auto', 'manual'],
      turnOwner: 'either',
      boundaries: 'provider',
      textInput: false,
      faceToFace: true,
      participantSpeech,
      speaks: sonioxSpeaks,
    }),
    build: (context, s, shared) => (context.speech ? sonioxTts(context, s, shared) : { ...sonioxTts(context, s, shared), off: true }),
    describe: (c) => (c.off ? {} : describeSonioxTts()),
    startSpeech: (request, events) => startSonioxSpeech(openSocket, request, events),
  };
}

/** The unit of a definition whose participant leg may or may not speak (the managed one's flag). */
export function sonioxTtsUnitFor({ participantSpeech }: { participantSpeech: boolean }): SonioxTtsUnit {
  return createSonioxTtsUnit({ participantSpeech });
}

export const sonioxTtsUnit: SonioxTtsUnit = createSonioxTtsUnit();
