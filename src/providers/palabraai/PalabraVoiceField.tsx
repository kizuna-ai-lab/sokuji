import PalabraVoiceSection from '../../components/Settings/sections/PalabraVoiceSection';
import { VoicePreviewContext } from '../../components/providers/VoicePreviewContext';
import type { LanguagePair, PreviewPort, ProviderAccount } from '../../lib/provider/types';
import { palabraParticipantVoice, type PalabraSettings } from './settings';
import { usePalabraVoiceSource } from './voiceSource';

interface PalabraVoiceFieldProps {
  settings: PalabraSettings;
  update(patch: Partial<PalabraSettings>): void;
  disabled: boolean;
  pair?: LanguagePair;
  account?: ProviderAccount;
  participantSpeaks?: boolean;
  /** The host's voice-preview route (`SettingsProps.preview`), so previews play on the chosen output. */
  preview?: PreviewPort;
}

/**
 * The voice library behind a thin wrapper (voice library spec §5), as
 * `SonioxVoiceField` is for Soniox: the account's source from its saved
 * credentials, both rows' choices with their names, and the host's preview
 * route. Without a pair (a component test) it reads English and auto-detect.
 */
export function PalabraVoiceField({ settings, update, disabled, pair, account, participantSpeaks = false, preview }: PalabraVoiceFieldProps) {
  const source = usePalabraVoiceSource(account, settings);
  return (
    <VoicePreviewContext.Provider value={preview ?? null}>
      <PalabraVoiceSection
        settings={{ voiceId: settings.voiceId, voiceName: settings.voiceName, participantVoiceId: settings.participantVoiceId, participantVoiceName: settings.participantVoiceName }}
        onSelect={(patch) => update(patch)}
        source={source}
        target={pair?.target ?? 'en'}
        pairSource={pair?.source ?? 'auto'}
        participant={participantSpeaks ? { effective: palabraParticipantVoice(settings) } : undefined}
        isSessionActive={disabled}
      />
    </VoicePreviewContext.Provider>
  );
}
