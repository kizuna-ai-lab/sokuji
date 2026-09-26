import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip/Tooltip';
import type { SettingsProps } from '../../lib/provider/types';
import type { SonioxSettings as S } from './settings';

/** One line, existing words only: the tuning's heading and the max pause (the knob users move). */
export function SonioxTurnDetectionSummary({ settings }: SettingsProps<S>) {
  const { t } = useTranslation();
  return <>{`${t('settings.sonioxEndpointTuning', 'Endpoint Detection Tuning')} · ${t('settings.sonioxEndpointMaxDelay', 'Max Pause Before Finalizing')}: ${settings.endpointMaxDelayMs} ms`}</>;
}

/**
 * The endpoint knobs (Soniox's `TurnDetection.Controls`): the old
 * `#soniox-endpoint-section` block (`ProviderSpecificSettings.tsx:1894-1966`),
 * unchanged but for its props. No `Help`: the section's summary links to
 * these controls, whose own tooltips explain each knob.
 */
export function SonioxTurnDetectionControls({ settings, update, disabled = false }: SettingsProps<S>) {
  const { t } = useTranslation();
  return (
    <div className="settings-section" id="soniox-endpoint-section">
      <h2>{t('settings.sonioxEndpointTuning', 'Endpoint Detection Tuning')}</h2>
      <div className="setting-item">
        <div className="setting-label">
          <span>
            {t('settings.sonioxEndpointSensitivity', 'Endpoint Sensitivity')}
            <Tooltip
              content={t('settings.sonioxEndpointSensitivityTooltip', 'How readily a pause is judged as the end of an utterance — higher splits on weaker evidence (snappier, more premature cut-offs), lower demands stronger evidence. Time is bounded by the max-pause setting below. 0 is the Soniox default.')}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
            </Tooltip>
          </span>
          <span className="setting-value">{settings.endpointSensitivity.toFixed(1)}</span>
        </div>
        <input
          id="soniox-endpoint-sensitivity"
          aria-label={t('settings.sonioxEndpointSensitivity', 'Endpoint Sensitivity')}
          type="range" min="-1" max="1" step="0.1"
          value={settings.endpointSensitivity}
          onChange={(e) => update({ endpointSensitivity: parseFloat(e.target.value) })}
          className="slider" disabled={disabled}
        />
      </div>
      <div className="setting-item">
        <div className="setting-label">
          <span>
            {t('settings.sonioxEndpointMaxDelay', 'Max Pause Before Finalizing')}
            <Tooltip
              content={t('settings.sonioxEndpointMaxDelayTooltip', 'A hard ceiling: once speech stops, the utterance closes after at most this long, however the sensitivity judgment leans. Raise it to keep sentences with mid-sentence pauses whole; lower it for faster finalization. 2000 ms is the Soniox default.')}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
            </Tooltip>
          </span>
          <span className="setting-value">{`${settings.endpointMaxDelayMs} ms`}</span>
        </div>
        <input
          id="soniox-endpoint-max-delay"
          aria-label={t('settings.sonioxEndpointMaxDelay', 'Max Pause Before Finalizing')}
          type="range" min="500" max="3000" step="100"
          value={settings.endpointMaxDelayMs}
          onChange={(e) => update({ endpointMaxDelayMs: parseInt(e.target.value, 10) })}
          className="slider" disabled={disabled}
        />
      </div>
      <div className="setting-item">
        <div className="setting-label">
          <span>
            {t('settings.sonioxEndpointLatencyLevel', 'Latency Reduction Level')}
            <Tooltip
              content={t('settings.sonioxEndpointLatencyLevelTooltip', 'Progressively more aggressive latency reduction when closing an utterance. 0 is the default behavior.')}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
            </Tooltip>
          </span>
        </div>
        <select
          id="soniox-endpoint-latency-level"
          aria-label={t('settings.sonioxEndpointLatencyLevel', 'Latency Reduction Level')}
          className="select-dropdown"
          value={settings.endpointLatencyAdjustmentLevel}
          onChange={(e) => update({ endpointLatencyAdjustmentLevel: parseInt(e.target.value, 10) })}
          disabled={disabled}
        >
          <option value={0}>{`0 — ${t('settings.sonioxLatencyLevelDefault', 'Default')}`}</option>
          <option value={1}>{`1 — ${t('settings.sonioxLatencyLevelLower', 'Lower latency')}`}</option>
          <option value={2}>{`2 — ${t('settings.sonioxLatencyLevelEvenLower', 'Even lower latency')}`}</option>
          <option value={3}>{`3 — ${t('settings.sonioxLatencyLevelMost', 'Most aggressive')}`}</option>
        </select>
      </div>
    </div>
  );
}
