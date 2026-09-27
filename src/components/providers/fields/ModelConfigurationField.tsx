import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';

export interface NumberRange { min: number; max: number; step: number }

export interface ModelConfigurationFieldProps {
  temperature: number;
  maxTokens: number | 'inf';
  temperatureRange: NumberRange;
  maxTokensRange: NumberRange;
  onChange(patch: { temperature?: number; maxTokens?: number | 'inf' }): void;
  disabled?: boolean;
}

const inlineHelpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />;

/** A model's sampling and output length (F13): the old "Model configuration" section; unticking Unlimited sets the range's maximum, as it did. */
export function ModelConfigurationField({ temperature, maxTokens, temperatureRange, maxTokensRange, onChange, disabled = false }: ModelConfigurationFieldProps) {
  const { t } = useTranslation();
  const unlimited = maxTokens === 'inf';
  return (
    <div className="settings-section">
      <h2>{t('settings.modelConfiguration')}</h2>
      <div className="setting-item">
        <div className="setting-label">
          <span>
            {t('settings.temperature')}
            <Tooltip content={t('settings.temperatureTooltip')} position="top">{inlineHelpIcon}</Tooltip>
          </span>
          <span className="setting-value">{temperature.toFixed(2)}</span>
        </div>
        <input
          type="range" aria-label={t('settings.temperature')}
          min={temperatureRange.min} max={temperatureRange.max} step={temperatureRange.step} value={temperature}
          onChange={(e) => onChange({ temperature: parseFloat(e.target.value) })}
          className="slider" disabled={disabled}
        />
      </div>
      <div className="setting-item">
        <div className="setting-label">
          <span className="label-with-checkbox">
            {t('settings.maxTokens')}
            <Tooltip content={t('settings.maxTokensTooltip')} position="top">{inlineHelpIcon}</Tooltip>
            <label className="unlimited-checkbox">
              <input type="checkbox" checked={unlimited} onChange={(e) => onChange({ maxTokens: e.target.checked ? 'inf' : maxTokensRange.max })} disabled={disabled} />
              <span>{t('settings.unlimited', 'Unlimited')}</span>
            </label>
          </span>
          <span className="setting-value">{unlimited ? t('settings.unlimited', 'Unlimited') : maxTokens}</span>
        </div>
        {!unlimited && (
          <input
            type="range" aria-label={t('settings.maxTokens')}
            min={maxTokensRange.min} max={maxTokensRange.max} step={maxTokensRange.step} value={maxTokens}
            onChange={(e) => onChange({ maxTokens: parseInt(e.target.value, 10) })}
            className="slider" disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}
