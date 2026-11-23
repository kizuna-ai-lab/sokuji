import { kizunaHostedIcon, SonioxIcon } from '../../components/Icons/ProviderIcons';
import { managed } from '../../lib/provider/managed';
import { asSonioxRegion } from '../../lib/soniox/regions';
import { kizunaSonioxMinimumBalance } from './kizunaBudget';
import { createKizunaLease } from './lease';
import { getApiUrl } from '../../utils/environment';
import { useManagedVoiceSource } from './managedVoiceSource';
import { sonioxAdapter, sonioxFileRecognitionBase, sonioxProvider } from './provider';
import { createSonioxSettingsView } from './SonioxSettings';
import { sonioxUnitsFor } from './units';
import { createSonioxVoiceSummary } from './SonioxVoiceSummary';
import { createKizunaVoiceClaim } from './voiceClaim';
import { voiceLeaseMemory } from './voiceLeaseMemory';

/** Kizuna Soniox's settings: Soniox's own, with the managed copy and the account's one cached voice (Plan A choice 12). */
export const KizunaSonioxSettingsView = createSonioxSettingsView({ providerId: 'kizunaai_soniox', managed: true, useVoiceSource: useManagedVoiceSource });
const KizunaSonioxVoiceSummary = createSonioxVoiceSummary({ managed: true });

/**
 * Managed participant speech (ruling 2): on since sokuji-backend mints
 * `par_tts` (sokuji-backend#94). The participant's speech key in every
 * mode, priced at the TTS rate; face-to-face is what voices it, the
 * participant-speech switch staying hidden.
 */
export const KIZUNA_PARTICIPANT_SPEECH = true;

/**
 * Kizuna AI's managed Soniox (spec: "Managed twins are composition"):
 * Soniox's languages, builder and adapter under the old enum's id and
 * slice, so a stored selection and settings carry over; the sign-in in
 * place of a key; the lease that mints each leg's keys and ends the run
 * with its grant; the voice claim; the balance floor. The one
 * participant-speech flag reaches its units, its lease and its floor
 * (choice 11); the tests build a flag-on twin here.
 */
export function createKizunaSonioxProvider({ participantSpeech }: { participantSpeech: boolean }) {
  return managed(sonioxProvider, {
    id: 'kizunaai_soniox',
    vendor: 'Soniox',
    icon: kizunaHostedIcon(SonioxIcon),
    guideUrl: 'https://sokuji.kizuna.ai/docs/kizuna-ai/quick-start',
    settingsKey: 'kizunaSoniox',
    Settings: KizunaSonioxSettingsView,
    VoiceSummary: KizunaSonioxVoiceSummary,
    signedOut: 'Sign in to use Kizuna AI Soniox.',
    // Soniox's two units over the same adapter, with this definition's own participant-speech flag.
    units: sonioxUnitsFor({ start: sonioxAdapter.start, participantSpeech }),
    // A saved recording as a file job of the signed-in account at the Kizuna AI service, which runs it at Soniox in the
    // region the settings name, the same one live sessions use (owner, 2026-11-18). No key: the History page attaches
    // the service's address and the sign-in.
    fileRecognition: (settings, _credentials, words) => ({
      service: 'kizunaai_soniox', hosted: true, region: asSonioxRegion(settings.region), ...sonioxFileRecognitionBase(words),
    }),
    session: {
      prepare: createKizunaVoiceClaim(),
      // A voice-only lease is remembered in the app's storage until it is ended, for a launch after a crash to end.
      acquire: createKizunaLease({ participantSpeech, apiUrl: getApiUrl, voiceLeases: voiceLeaseMemory }),
      minimumBalance: (shape, s) => kizunaSonioxMinimumBalance(shape, s, participantSpeech),
    },
  });
}

/** Released first, unflagged (ruling 6): present wherever the Kizuna umbrella is on. */
export const kizunaSonioxProvider = createKizunaSonioxProvider({ participantSpeech: KIZUNA_PARTICIPANT_SPEECH });
