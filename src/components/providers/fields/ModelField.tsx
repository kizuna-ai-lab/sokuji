import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import type { ModelOption } from '../../../lib/provider/types';

export interface ModelFieldProps {
  /** The model a session would run: the provider's effective model, not necessarily the saved one. */
  value: string;
  /** What the provider's check listed (`SettingsProps.models`), newest first. */
  models: readonly ModelOption[];
  onChange(model: string): void;
  disabled?: boolean;
}

/**
 * A provider's model choice (F13). The list is its check's; the credential
 * form's Validate lists them again, so there is no refresh button. Before
 * a check has listed any, the saved model alone, locked.
 */
export function ModelField({ value, models, onChange, disabled = false }: ModelFieldProps) {
  const { t } = useTranslation();
  const none = models.length === 0;
  return (
    <div className="settings-section">
      <h2>
        {t('settings.model')}
        <Tooltip content={t('settings.modelTooltip')} position="top">
          <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
        </Tooltip>
      </h2>
      <div className="setting-item">
        <div className="model-selection-container">
          <select className="select-dropdown" aria-label={t('settings.model')} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || none}>
            {none
              ? value && <option value={value}>{value}</option>
              : models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
          </select>
        </div>
        {!none && <div className="models-info">{t('settings.modelsFound', 'Found {{count}} available models', { count: models.length })}</div>}
      </div>
    </div>
  );
}
