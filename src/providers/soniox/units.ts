/**
 * Soniox as units: the STT connection, which transcribes and translates
 * on one socket, and the voice, which reads translations on its own. A
 * session on Soniox alone runs both; another provider's voice may stand in
 * for the second. Both definitions, the user's own key and Kizuna AI's,
 * declare these with their own adapter and their own participant-speech flag.
 * The same connection asked for no translation is a third unit, which
 * transcribes alone for another provider's unit to translate
 * (`sonioxTranscriptionUnitFor`).
 */
import type { Adapter } from '../../lib/contract/adapter';
import { TR, TR_TL } from '../../lib/lineup/types';
import { sameStages } from '../../lib/plan/types';
import type { UnitDefinition } from '../../lib/run/types';
import { buildSoniox, buildSonioxAlone, describeSoniox, type SonioxConfig } from './config';
import type { SonioxCredentials, SonioxSettings } from './settings';
import { sonioxTtsUnitFor, type SonioxTtsUnit } from './ttsUnit';

export type SonioxSttUnit = UnitDefinition<SonioxSettings, SonioxCredentials, SonioxConfig>;

export interface SonioxSttUnitParts {
  /** The adapter's one-leg start. */
  start: Adapter<SonioxConfig, SonioxCredentials>['start'];
  /** False: the participant leg never speaks, whatever its switch says. Absent: it may. */
  participantSpeech?: boolean;
}

/**
 * Soniox's text unit: transcription and translation together, and only when asked for exactly those. It is the
 * adapter, which never speaks: it opens no TTS socket, says nothing of a speech key, and the model it describes is
 * the STT one alone. Its config is the definition's own: what `startBoth` reads (`sharedBoth`, `faceToFace`) and the
 * agent text option, which follows `shared.speaks` whoever speaks.
 */
export function sonioxSttUnitFor({ start, participantSpeech }: SonioxSttUnitParts): SonioxSttUnit {
  return {
    id: 'stt',
    occupies: (_s, want) => (sameStages(TR_TL, want) ? TR_TL : null),
    capabilities: () => ({
      speech: 'never',
      turns: ['auto', 'manual'],
      turnOwner: 'either',
      boundaries: 'provider',
      textInput: false,
      faceToFace: true,
      participantSpeech: participantSpeech !== false,
    }),
    build: buildSoniox,
    describe: describeSoniox,
    start,
  };
}

/** The id of the unit that transcribes alone. */
export const SONIOX_TRANSCRIPTION_UNIT = 'transcription';

/**
 * Soniox's STT connection serving transcription alone, and only when asked for exactly that (step 4, R9): the same
 * adapter over a config that says so (`buildSonioxAlone`), so the socket is asked for no translation and only
 * source segments are said. Turns and boundaries are the connection's. Not face-to-face: that needs the one socket
 * that carries both people, and a leg whose translation is another unit's has a socket of its own. It describes
 * the STT model and no translation model: the translation is named by the unit that translates.
 */
export function sonioxTranscriptionUnitFor({ start, participantSpeech }: SonioxSttUnitParts): SonioxSttUnit {
  return {
    id: SONIOX_TRANSCRIPTION_UNIT,
    occupies: (_s, want) => (sameStages(TR, want) ? TR : null),
    capabilities: () => ({
      speech: 'never',
      turns: ['auto', 'manual'],
      turnOwner: 'either',
      boundaries: 'provider',
      textInput: false,
      faceToFace: false,
      participantSpeech: participantSpeech !== false,
    }),
    build: buildSonioxAlone,
    describe: describeSoniox,
    start,
  };
}

/**
 * A definition's three units: its text unit over its adapter, the same adapter transcribing alone, and its voice.
 * The composer takes the text unit where the line-up gives Soniox the translation too, and the unit that
 * transcribes alone where another provider translates.
 */
export function sonioxUnitsFor(parts: SonioxSttUnitParts): readonly [SonioxSttUnit, SonioxSttUnit, SonioxTtsUnit] {
  return [sonioxSttUnitFor(parts), sonioxTranscriptionUnitFor(parts), sonioxTtsUnitFor({ participantSpeech: parts.participantSpeech !== false })];
}
