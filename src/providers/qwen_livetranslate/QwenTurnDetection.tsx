import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip/Tooltip';
import type { SettingsProps } from '../../lib/provider/types';
import { QWEN_PAUSE, type QwenSettings as S } from './settings';

const helpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />;
const inlineHelpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />;

/** One line, existing words only: Gemini's VAD heading and silence duration, which name the same knob. */
export function QwenTurnDetectionSummary({ settings }: SettingsProps<S>) {
  const { t } = useTranslation();
  return <>{`${t('settings.vadSettings', 'VAD Settings')} · ${t('settings.vadSilenceDuration', 'Silence Duration')}: ${settings.pauseMs}ms`}</>;
}

/**
 * The pause that ends a turn under automatic turns (`turn_detection.silence_duration_ms`,
 * undocumented for 3.8 but honoured; probe 2026-10-13): Gemini's words and slider, Qwen's
 * range. A turn still ends at once when the speaker changes; push-to-talk does not read it.
 */
export function QwenTurnDetectionControls({ settings, update, disabled = false }: SettingsProps<S>) {
  const { t } = useTranslation();
  return (
    <div className="settings-section" id="qwen-vad-section">
      <h2>
        {t('settings.vadSettings', 'VAD Settings')}
        <Tooltip content={t('settings.vadSettingsTooltip')} position="top">{helpIcon}</Tooltip>
      </h2>
      <div className="setting-item">
        <div className="setting-label">
          <span>
            {t('settings.vadSilenceDuration', 'Silence Duration')}
            <Tooltip content={t('settings.vadSilenceDurationTooltip')} position="top">{inlineHelpIcon}</Tooltip>
          </span>
          <span className="setting-value">{settings.pauseMs}ms</span>
        </div>
        <input
          type="range" aria-label={t('settings.vadSilenceDuration', 'Silence Duration')}
          min={QWEN_PAUSE.min} max={QWEN_PAUSE.max} step={QWEN_PAUSE.step}
          value={settings.pauseMs}
          onChange={(e) => update({ pauseMs: parseInt(e.target.value, 10) })}
          className="slider" disabled={disabled}
        />
      </div>
    </div>
  );
}
