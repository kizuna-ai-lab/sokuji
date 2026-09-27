import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip/Tooltip';
import type { SettingsProps } from '../../lib/provider/types';
import { GEMINI_VAD_PREFIX_RANGE, GEMINI_VAD_SILENCE_RANGE, type GeminiSettings as S } from './settings';

const helpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />;
const inlineHelpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />;
const VAD_TOOLTIP = 'Voice Activity Detection parameters. Controls how speech segments are detected and split. Changes take effect on next session start.';

/** One line, existing words only: the VAD heading and the silence duration (choice 23). */
export function GeminiTurnDetectionSummary({ settings }: SettingsProps<S>) {
  const { t } = useTranslation();
  return <>{`${t('settings.vadSettings', 'VAD Settings')} · ${t('settings.vadSilenceDuration', 'Silence Duration')}: ${settings.vadSilenceDurationMs}ms`}</>;
}

/** The VAD tooltip, beside the Speech section's summary (`geminiVadTooltip` still describes the push modes). */
export function GeminiTurnDetectionHelp(_props: SettingsProps<S>) {
  const { t } = useTranslation();
  return <Tooltip content={t('settings.vadSettingsTooltip', VAD_TOOLTIP)} position="top">{inlineHelpIcon}</Tooltip>;
}

/**
 * The old `#gemini-vad-section` knobs (`ProviderSpecificSettings.tsx:1107-1221`)
 * under the VAD heading: the Provider tab draws them in every turn mode,
 * and the setup sends them for both kinds (choice 23).
 */
export function GeminiTurnDetectionControls({ settings, update, disabled = false }: SettingsProps<S>) {
  const { t } = useTranslation();
  const levels = (field: 'vadStartSensitivity' | 'vadEndSensitivity') => (
    <div className="turn-detection-options">
      {(['high', 'low'] as const).map((level) => (
        <button
          key={level}
          type="button"
          className={`option-button ${settings[field] === level ? 'active' : ''}`}
          onClick={() => update(field === 'vadStartSensitivity' ? { vadStartSensitivity: level } : { vadEndSensitivity: level })}
          disabled={disabled}
        >
          {level === 'high' ? t('settings.sensitivityHigh', 'High') : t('settings.sensitivityLow', 'Low')}
        </button>
      ))}
    </div>
  );
  return (
    <div className="settings-section" id="gemini-vad-section">
      <h2>
        {t('settings.vadSettings', 'VAD Settings')}
        <Tooltip content={t('settings.vadSettingsTooltip', VAD_TOOLTIP)} position="top">{helpIcon}</Tooltip>
      </h2>
      <div className="setting-item">
        <div className="setting-label">
          <span>
            {t('settings.startOfSpeechSensitivity', 'Start of Speech Sensitivity')}
            <Tooltip content={t('settings.startOfSpeechSensitivityTooltip')} position="top">{inlineHelpIcon}</Tooltip>
          </span>
        </div>
        {levels('vadStartSensitivity')}
      </div>
      <div className="setting-item">
        <div className="setting-label">
          <span>
            {t('settings.endOfSpeechSensitivity', 'End of Speech Sensitivity')}
            <Tooltip content={t('settings.endOfSpeechSensitivityTooltip')} position="top">{inlineHelpIcon}</Tooltip>
          </span>
        </div>
        {levels('vadEndSensitivity')}
      </div>
      <div className="setting-item">
        <div className="setting-label">
          <span>
            {t('settings.vadSilenceDuration', 'Silence Duration')}
            <Tooltip content={t('settings.vadSilenceDurationTooltip')} position="top">{inlineHelpIcon}</Tooltip>
          </span>
          <span className="setting-value">{settings.vadSilenceDurationMs}ms</span>
        </div>
        <input
          type="range" aria-label={t('settings.vadSilenceDuration', 'Silence Duration')}
          min={GEMINI_VAD_SILENCE_RANGE.min} max={GEMINI_VAD_SILENCE_RANGE.max} step={GEMINI_VAD_SILENCE_RANGE.step}
          value={settings.vadSilenceDurationMs}
          onChange={(e) => update({ vadSilenceDurationMs: parseInt(e.target.value, 10) })}
          className="slider" disabled={disabled}
        />
      </div>
      <div className="setting-item">
        <div className="setting-label">
          <span>
            {t('settings.vadPrefixPadding', 'Prefix Padding')}
            <Tooltip content={t('settings.vadPrefixPaddingTooltip')} position="top">{inlineHelpIcon}</Tooltip>
          </span>
          <span className="setting-value">{settings.vadPrefixPaddingMs}ms</span>
        </div>
        <input
          type="range" aria-label={t('settings.vadPrefixPadding', 'Prefix Padding')}
          min={GEMINI_VAD_PREFIX_RANGE.min} max={GEMINI_VAD_PREFIX_RANGE.max} step={GEMINI_VAD_PREFIX_RANGE.step}
          value={settings.vadPrefixPaddingMs}
          onChange={(e) => update({ vadPrefixPaddingMs: parseInt(e.target.value, 10) })}
          className="slider" disabled={disabled}
        />
      </div>
    </div>
  );
}
