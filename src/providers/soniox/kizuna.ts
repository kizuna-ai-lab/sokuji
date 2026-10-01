import { kizunaHostedIcon, SonioxIcon } from '../../components/Icons/ProviderIcons';
import { managed } from '../../lib/provider/managed';
import { kizunaSonioxMinimumBalance } from './kizunaBudget';
import { createKizunaLease } from './lease';
import { useManagedVoiceSource } from './managedVoiceSource';
import { sonioxProvider } from './provider';
import { createSonioxSettingsView } from './SonioxSettings';
import { createKizunaVoiceClaim } from './voiceClaim';

/** Kizuna Soniox's settings: Soniox's own, with the managed copy and the account's one cached voice (Plan A choice 12). */
export const KizunaSonioxSettingsView = createSonioxSettingsView({ managed: true, useVoiceSource: useManagedVoiceSource });

/**
 * Managed participant speech (ruling 2): built end to end — the
 * request's intent, the participant's `par_tts` key in every mode, the
 * floors from the roles — and shipped off until the backend mints
 * `par_tts`. Turning it on is the roadmap's checklist ("Scheduled by the
 * Stage 2 Kizuna Soniox plan"): the backend first, then the request
 * field's name (`PARTICIPANT_SPEECH_FIELD`), then this line.
 */
export const KIZUNA_PARTICIPANT_SPEECH = false;

/**
 * Kizuna AI's managed Soniox (spec: "Managed twins are composition"):
 * Soniox's languages, builder and adapter under the old enum's id and
 * slice, so a stored selection and settings carry over; the sign-in in
 * place of a key; the lease that mints each leg's keys and ends the run
 * with its grant; the voice claim; the balance floor. The one
 * participant-speech flag reaches the definition's capability, its lease
 * and its floor (choice 11); the tests build a flag-on twin here.
 */
export function createKizunaSonioxProvider({ participantSpeech }: { participantSpeech: boolean }) {
  return managed(sonioxProvider, {
    id: 'kizunaai_soniox',
    vendor: 'Soniox',
    icon: kizunaHostedIcon(SonioxIcon),
    settingsKey: 'kizunaSoniox',
    Settings: KizunaSonioxSettingsView,
    signedOut: 'Sign in to use Kizuna AI Soniox.',
    participantSpeech,
    session: {
      prepare: createKizunaVoiceClaim(),
      acquire: createKizunaLease({ participantSpeech }),
      minimumBalance: (shape, s) => kizunaSonioxMinimumBalance(shape, s, participantSpeech),
    },
  });
}

/** Released first, unflagged (ruling 6): present wherever the Kizuna umbrella is on. */
export const kizunaSonioxProvider = createKizunaSonioxProvider({ participantSpeech: KIZUNA_PARTICIPANT_SPEECH });
