import { useTranslation } from 'react-i18next';
import { PresetVoiceField, presetVoice } from '../../components/providers/fields/PresetVoiceField';
import type { VoiceEntry } from '../../components/Settings/sections/VoiceLibrarySection';
import type { SettingsProps, VoiceSummaryProps } from '../../lib/provider/types';
import { isEndpointId } from './endpoints';
import { QWEN_VOICES, qwenParticipantVoice, qwenSpeakerVoice, SPEAKER_CLONE, type QwenSettings as S } from './settings';

/** The voice a spoken leg reads in, for the Speech rows, as its run resolves it: a preset's name, or whose own voice is cloned. */
export function QwenVoiceSummary({ settings, leg }: VoiceSummaryProps<S>) {
  const { t } = useTranslation();
  const id = leg === 'participant' ? qwenParticipantVoice(settings) : qwenSpeakerVoice(settings);
  if (id === SPEAKER_CLONE) {
    return <>{leg === 'participant'
      ? t('providers.qwen_livetranslate.voiceSummaryCloneTheirs', 'Their own voice (cloned)')
      : t('providers.qwen_livetranslate.voiceSummaryCloneMine', 'Your own voice (cloned)')}</>;
  }
  return <>{QWEN_VOICES.find((v) => v.value === id)?.name ?? id}</>;
}

/**
 * Qwen LiveTranslate's own settings (spec §7): the storefront the check
 * found, as a line under the key, and the voice — cloning the speaker under
 * a heading of its own, then the 47 presets, as Doubao AST 2.0 lists them.
 * No preview: the official voice list publishes no samples. No model,
 * region or instructions: the endpoint has none.
 */
export function QwenSettingsView({ settings, update, disabled = false, participantSpeaks = false, models = [], preview }: SettingsProps<S>) {
  const { t } = useTranslation();
  const voices: VoiceEntry[] = [
    {
      id: SPEAKER_CLONE, label: t('providers.qwen_livetranslate.voiceClone', "Clone the speaker's voice"), group: 'builtin', removable: false,
      section: t('providers.qwen_livetranslate.voiceGroupClone', 'Voice cloning'),
    },
    ...QWEN_VOICES.map((v) => presetVoice(v)),
  ];
  const storefront = models[0]?.id;
  return (
    <>
      {isEndpointId(storefront) && (
        <div className="settings-section">
          <div className="models-info">
            {storefront === 'intl'
              ? t('providers.qwen_livetranslate.storefrontIntl', 'Key from QwenCloud (international)')
              : t('providers.qwen_livetranslate.storefrontCn', 'Key from 千问云 (mainland China)')}
          </div>
        </div>
      )}
      <PresetVoiceField
        voices={voices} value={settings.voice} onChange={(voice) => update({ voice })} preview={preview} disabled={disabled}
        participant={participantSpeaks ? { value: settings.participantVoice, effective: qwenParticipantVoice(settings), onChange: (participantVoice) => update({ participantVoice }) } : undefined}
      />
    </>
  );
}
