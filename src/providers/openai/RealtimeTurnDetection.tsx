import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip/Tooltip';
import type { SettingsProps } from '../../lib/provider/types';
import {
  REALTIME_PREFIX_RANGE, REALTIME_SILENCE_RANGE, REALTIME_THRESHOLD_RANGE, SEMANTIC_EAGERNESSES, TURN_DETECTION_MODES, type RealtimeSettings as S,
  type SemanticEagerness,
} from './settings';

const helpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />;
const inlineHelpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />;

const eagernessKey = (e: SemanticEagerness) => `settings.${e.toLowerCase()}`;

/** One line, existing words only (choice 17): the mechanism and the knob that shapes it most. */
export function RealtimeTurnDetectionSummary({ settings }: SettingsProps<S>) {
  const { t } = useTranslation();
  if (settings.turnDetectionMode === 'Semantic') return <>{`${t('settings.semantic')} · ${t('settings.eagerness')} ${t(eagernessKey(settings.semanticEagerness))}`}</>;
  return <>{`${t('settings.normal')} · ${t('settings.threshold')} ${settings.threshold.toFixed(2)} · ${t('settings.silenceDuration')} ${settings.silenceDuration.toFixed(2)}s`}</>;
}

/** The old speech-mode tooltip, which tells Normal from Semantic, beside the Speech section's summary. */
export function RealtimeTurnDetectionHelp(_props: SettingsProps<S>) {
  const { t } = useTranslation();
  return <Tooltip content={t('settings.turnDetectionTooltip')} position="top">{inlineHelpIcon}</Tooltip>;
}

/**
 * The old turn-detection section's knobs (`ProviderSpecificSettings.tsx:
 * 508-719`) under the VAD heading, as Gemini's: the two automatic
 * mechanisms and each one's knobs. The push modes are the global turn
 * mode's now (the Speech section), and the old WebRTC notice went with
 * WebRTC (2026-09-29). Both legs use them: the participant's detection is the
 * user's own (ruling 4).
 */
export function RealtimeTurnDetectionControls({ settings, update, disabled = false }: SettingsProps<S>) {
  const { t } = useTranslation();
  const slider = (value: number, write: (v: number) => void, label: string, tooltip: string, range: { min: number; max: number; step: number }, unit: string) => (
    <div className="setting-item">
      <div className="setting-label">
        <span>
          {t(label)}
          <Tooltip content={t(tooltip)} position="top">{inlineHelpIcon}</Tooltip>
        </span>
        <span className="setting-value">{value.toFixed(2)}{unit}</span>
      </div>
      <input
        type="range" aria-label={t(label)}
        min={range.min} max={range.max} step={range.step} value={value}
        onChange={(e) => write(parseFloat(e.target.value))}
        className="slider" disabled={disabled}
      />
    </div>
  );
  return (
    <div className="settings-section" id="openai-vad-section">
      <h2>
        {t('settings.vadSettings', 'VAD Settings')}
        <Tooltip content={t('settings.turnDetectionTooltip')} position="top">{helpIcon}</Tooltip>
      </h2>
      <div className="setting-item">
        <div className="turn-detection-options">
          {TURN_DETECTION_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`option-button ${settings.turnDetectionMode === mode ? 'active' : ''}`}
              onClick={() => update({ turnDetectionMode: mode })}
              disabled={disabled}
            >
              {t(`settings.${mode.toLowerCase()}`)}
            </button>
          ))}
        </div>
      </div>
      {settings.turnDetectionMode === 'Normal' && (
        <>
          {slider(settings.threshold, (threshold) => update({ threshold }), 'settings.threshold', 'settings.thresholdTooltip', REALTIME_THRESHOLD_RANGE, '')}
          {slider(settings.prefixPadding, (prefixPadding) => update({ prefixPadding }), 'settings.prefixPadding', 'settings.prefixPaddingTooltip', REALTIME_PREFIX_RANGE, 's')}
          {slider(settings.silenceDuration, (silenceDuration) => update({ silenceDuration }), 'settings.silenceDuration', 'settings.silenceDurationTooltip', REALTIME_SILENCE_RANGE, 's')}
        </>
      )}
      {settings.turnDetectionMode === 'Semantic' && (
        <div className="setting-item">
          <div className="setting-label">
            <span>
              {t('settings.eagerness')}
              <Tooltip content={t('settings.semanticEagernessTooltip')} position="top">{inlineHelpIcon}</Tooltip>
            </span>
          </div>
          <select
            className="select-dropdown" aria-label={t('settings.eagerness')}
            value={settings.semanticEagerness}
            onChange={(e) => update({ semanticEagerness: e.target.value as SemanticEagerness })}
            disabled={disabled}
          >
            {SEMANTIC_EAGERNESSES.map((e) => <option key={e} value={e}>{t(eagernessKey(e))}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
