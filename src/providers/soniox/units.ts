/**
 * Soniox as two units: the STT connection, which transcribes and translates
 * on one socket, and the voice, which reads translations on its own. A
 * session on Soniox alone runs both; another provider's voice may stand in
 * for the second. Both definitions, the user's own key and Kizuna AI's,
 * declare these with their own adapter and their own participant-speech flag.
 */
import type { Adapter } from '../../lib/contract/adapter';
import { TR_TL } from '../../lib/lineup/types';
import { sameStages, type UnitDefinition } from '../../lib/plan/types';
import { buildSoniox, describeSoniox, type SonioxConfig } from './config';
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

/** A definition's two units, in stage order: its text unit over its adapter, and its voice. */
export function sonioxUnitsFor(parts: SonioxSttUnitParts): readonly [SonioxSttUnit, SonioxTtsUnit] {
  return [sonioxSttUnitFor(parts), sonioxTtsUnitFor({ participantSpeech: parts.participantSpeech !== false })];
}
