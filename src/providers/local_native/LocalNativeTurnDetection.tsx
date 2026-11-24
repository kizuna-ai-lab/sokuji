import { useTranslation } from 'react-i18next';
import { CircleHelp } from 'lucide-react';
import Tooltip from '../../components/Tooltip/Tooltip';
import type { SettingsProps } from '../../lib/provider/types';
import type { LocalNativeSettings as S } from './settings';

const helpIcon = (
  <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
);

/**
 * Local Native's VAD knobs: the renderer's Silero worker takes three (no max
 * duration — it cuts at 19 s itself), whatever model runs, so every part shows
 * always. Same words as LocalInference's (`VadControl`'s own keys).
 */
export function LocalNativeTurnDetectionSummary({ settings }: SettingsProps<S>) {
  const { t } = useTranslation();
  return <>{`${t('settings.vadSettings', 'VAD Settings')} · ${t('settings.vadMinSilenceDuration', 'Min Silence Duration')}: ${settings.vadMinSilenceDuration.toFixed(2)}s`}</>;
}

export function LocalNativeTurnDetectionHelp(_props: SettingsProps<S>) {
  const { t } = useTranslation();
  return (
    <Tooltip content={t('settings.vadSettingsTooltip', 'Voice Activity Detection parameters. Controls how speech segments are detected and split. Changes take effect on next session start.')} position="top">
      {helpIcon}
    </Tooltip>
  );
}

type NativeVad = Pick<S, 'vadThreshold' | 'vadMinSilenceDuration' | 'vadMinSpeechDuration'>;

/**
 * The three knobs as sliders, same words and look as the shared turn-detection
 * controls. Local Native keeps its own until it moves onto the shared detector
 * (design step 4); the shared panel takes the local-inference scope only.
 */
export function LocalNativeTurnDetectionControls({ settings, update, disabled = false }: SettingsProps<S>) {
  const { t } = useTranslation();
  const slider = (
    key: keyof NativeVad, label: string, labelKey: string, tip: string, tipKey: string,
    min: string, max: string, unit: string,
  ) => (
    <div className="setting-item">
      <div className="setting-label">
        <span>
          <span id={`native-vad-${key}`}>{t(labelKey, label)}</span>
          <Tooltip content={t(tipKey, tip)} position="top">{helpIcon}</Tooltip>
        </span>
        <span className="setting-value">{settings[key].toFixed(2)}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step="0.05" value={settings[key]}
        onChange={(e) => update({ [key]: parseFloat(e.target.value) } as Partial<NativeVad>)}
        className="slider" disabled={disabled} aria-labelledby={`native-vad-${key}`}
      />
    </div>
  );
  return (
    <div className="settings-section">
      <h2>
        {t('settings.vadSettings', 'VAD Settings')}
        <LocalNativeTurnDetectionHelp settings={settings} update={update} />
      </h2>
      {slider('vadThreshold', 'Speech Threshold', 'settings.vadThreshold',
        'Speech detection sensitivity. Higher values require louder/clearer speech to trigger recognition. Lower values are more sensitive to quiet speech.',
        'settings.vadThresholdTooltip', '0.1', '0.95', '')}
      {slider('vadMinSilenceDuration', 'Min Silence Duration', 'settings.vadMinSilenceDuration',
        'Minimum silence duration to split speech segments. Shorter values split sentences faster, longer values wait for more natural pauses.',
        'settings.vadMinSilenceDurationTooltip', '0.05', '2.0', 's')}
      {slider('vadMinSpeechDuration', 'Min Speech Duration', 'settings.vadMinSpeechDuration',
        'Minimum speech duration to consider as valid speech. Filters out very short sounds like clicks or coughs.',
        'settings.vadMinSpeechDurationTooltip', '0.05', '1.0', 's')}
    </div>
  );
}
