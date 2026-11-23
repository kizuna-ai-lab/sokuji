import { useTranslation } from 'react-i18next';
import { CircleHelp } from 'lucide-react';
import { VadControl } from '../../components/Settings/sections/LocalSettingsControls';
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

export function LocalNativeTurnDetectionControls({ settings, update, disabled = false }: SettingsProps<S>) {
  return (
    <VadControl
      values={{
        vadThreshold: settings.vadThreshold,
        vadMinSilenceDuration: settings.vadMinSilenceDuration,
        vadMinSpeechDuration: settings.vadMinSpeechDuration,
      }}
      onChange={(patch) => update(patch)}
      disabled={disabled}
    />
  );
}
