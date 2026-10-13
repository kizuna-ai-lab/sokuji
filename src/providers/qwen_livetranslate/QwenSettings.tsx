import { useTranslation } from 'react-i18next';
import { LinesField } from '../../components/providers/fields/LinesField';
import { PresetVoiceField, presetVoice } from '../../components/providers/fields/PresetVoiceField';
import type { VoiceEntry } from '../../components/Settings/sections/VoiceLibrarySection';
import type { SettingsProps, VoiceSummaryProps } from '../../lib/provider/types';
import { isEndpointId } from './endpoints';
import { QWEN_VOICES, qwenParticipantVoice, qwenSpeakerVoice, SPEAKER_CLONE, SPEAKER_CLONE_ONCE, type QwenSettings as S } from './settings';

/** The voice a spoken leg reads in, for the Speech rows, as its run resolves it: a preset's name, or whose own voice is cloned. */
export function QwenVoiceSummary({ settings, leg }: VoiceSummaryProps<S>) {
  const { t } = useTranslation();
  const id = leg === 'participant' ? qwenParticipantVoice(settings) : qwenSpeakerVoice(settings);
  if (id === SPEAKER_CLONE || id === SPEAKER_CLONE_ONCE) {
    return <>{leg === 'participant'
      ? t('providers.qwen_livetranslate.voiceSummaryCloneTheirs', 'Their own voice (cloned)')
      : t('providers.qwen_livetranslate.voiceSummaryCloneMine', 'Your own voice (cloned)')}</>;
  }
  return <>{QWEN_VOICES.find((v) => v.value === id)?.name ?? id}</>;
}

/**
 * Qwen LiveTranslate's own settings (spec §7): the storefront the check
 * found, as a line under the key; the voice — cloning under a heading of its
 * own (each speaker on every turn, or the first speaker once), then the 47
 * presets, as Doubao AST 2.0 lists them; and the preferred translations
 * (`translation.corpus`), Soniox's field and words. No preview: the official
 * voice list publishes no samples. No model, region or instructions: the
 * endpoint has none.
 */
export function QwenSettingsView({ settings, update, disabled = false, participantSpeaks = false, models = [], preview }: SettingsProps<S>) {
  const { t } = useTranslation();
  const cloning = t('providers.qwen_livetranslate.voiceGroupClone', 'Voice cloning');
  const voices: VoiceEntry[] = [
    { id: SPEAKER_CLONE, label: t('providers.qwen_livetranslate.voiceClone', "Clone the speaker's voice"), group: 'builtin', removable: false, section: cloning },
    { id: SPEAKER_CLONE_ONCE, label: t('providers.qwen_livetranslate.voiceCloneOnce', "Clone the first speaker's voice"), group: 'builtin', removable: false, section: cloning },
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
      <div className="settings-section" id="qwen-vocabulary-section">
        {/* No heading tooltip: Soniox's speaks of recognition too, which Qwen's corpus does not touch; the field's own explains it. */}
        <h2>{t('providers.qwen_livetranslate.vocabulary', 'Custom Vocabulary')}</h2>
        <LinesField
          id="qwen-vocabulary-translations"
          label={t('providers.qwen_livetranslate.vocabularyTranslations', 'Preferred Translations')}
          tooltip={t('providers.qwen_livetranslate.vocabularyTranslationsTooltip', "Biases how specific terms are translated — a preference, not a guaranteed replacement: names with an established rendering work best, while common words may keep the model's own wording. Entries are directional; the reverse direction only exists in Both mode, where you can add a reverse line.")}
          placeholder={t('providers.qwen_livetranslate.vocabularyTranslationsPlaceholder', 'One source=target per line')}
          value={settings.hotwords}
          onChange={(hotwords) => update({ hotwords })}
          disabled={disabled}
        />
      </div>
    </>
  );
}
