import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip/Tooltip';
import { REASONING_EFFORTS, type ReasoningEffort } from './settings';

export interface ReasoningEffortFieldProps {
  value: ReasoningEffort;
  onChange(effort: ReasoningEffort): void;
  disabled?: boolean;
}

/**
 * How much a `gpt-realtime-2*` model deliberates (choice 17): the old
 * section (`ProviderSpecificSettings.tsx:1044-1084`), in the provider's
 * folder. The view draws it for such a model alone, as the builder sends it.
 * The select gains an `aria-label`.
 */
export function ReasoningEffortField({ value, onChange, disabled = false }: ReasoningEffortFieldProps) {
  const { t } = useTranslation();
  return (
    <div className="settings-section">
      <h2>
        {t('settings.reasoningEffort')}
        <Tooltip content={t('settings.reasoningEffortTooltip')} position="top">
          <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
        </Tooltip>
      </h2>
      <div className="setting-item">
        <select className="select-dropdown" aria-label={t('settings.reasoningEffort')} value={value} onChange={(e) => onChange(e.target.value as ReasoningEffort)} disabled={disabled}>
          {REASONING_EFFORTS.map((effort) => <option key={effort} value={effort}>{t(`settings.reasoningEffortOptions.${effort}`, effort)}</option>)}
        </select>
      </div>
    </div>
  );
}
