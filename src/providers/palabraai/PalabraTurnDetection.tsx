import { useTranslation } from 'react-i18next';
import type { SettingsProps } from '../../lib/provider/types';
import { effectiveThreshold, SILENCE_THRESHOLD_RANGE, type PalabraSettings as S } from './settings';

/** One line, existing words only: the VAD heading and the silence threshold a session sends. */
export function PalabraTurnDetectionSummary({ settings }: SettingsProps<S>) {
  const { t } = useTranslation();
  return <>{`${t('settings.vadSettings', 'VAD Settings')} · ${t('settings.silenceThreshold', 'Silence Threshold')}: ${effectiveThreshold(settings).toFixed(2)}s`}</>;
}

/**
 * Palabra's one knob of its automatic segmentation (its `TurnDetection`
 * Controls): the old silence threshold slider (`ProviderSpecificSettings.tsx:1323-1340`)
 * under the VAD heading, its floor 0.3 — the API refuses less (ruling 10).
 * The Provider tab draws it in every turn mode: under push-to-talk it is
 * also how soon a released sentence closes. No `Help`: the old slider had
 * no tooltip.
 */
export function PalabraTurnDetectionControls({ settings, update, disabled = false }: SettingsProps<S>) {
  const { t } = useTranslation();
  const label = t('settings.silenceThreshold', 'Silence Threshold');
  const value = effectiveThreshold(settings);
  return (
    <div className="settings-section" id="palabra-vad-section">
      <h2>{t('settings.vadSettings', 'VAD Settings')}</h2>
      <div className="setting-item">
        <div className="setting-label">
          <span>{label}</span>
          <span className="setting-value">{value.toFixed(2)}s</span>
        </div>
        <input
          type="range" aria-label={label}
          min={SILENCE_THRESHOLD_RANGE.min} max={SILENCE_THRESHOLD_RANGE.max} step={SILENCE_THRESHOLD_RANGE.step}
          value={value}
          onChange={(e) => update({ segmentConfirmationSilenceThreshold: parseFloat(e.target.value) })}
          className="slider" disabled={disabled}
        />
      </div>
    </div>
  );
}
