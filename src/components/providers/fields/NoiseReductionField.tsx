import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';

export interface NoiseReductionFieldProps<V extends string> {
  value: V;
  /** The provider's values, shown as they are: the old select showed its raw modes too. */
  options: readonly V[];
  onChange(value: V): void;
  disabled?: boolean;
}

/**
 * Input noise reduction (the roadmap's "noise field"; Stage 2 OpenAI
 * Translate, choice 13): the old section
 * (`ProviderSpecificSettings.tsx:807-840`), shared by OpenAI Translate first
 * and OpenAI Realtime and Compatible next.
 */
export function NoiseReductionField<V extends string>({ value, options, onChange, disabled = false }: NoiseReductionFieldProps<V>) {
  const { t } = useTranslation();
  return (
    <div className="settings-section">
      <h2>
        {t('settings.noiseReduction')}
        <Tooltip content={t('settings.noiseReductionTooltip')} position="top">
          <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
        </Tooltip>
      </h2>
      <div className="setting-item">
        <select className="select-dropdown" aria-label={t('settings.noiseReduction')} value={value} onChange={(e) => onChange(e.target.value as V)} disabled={disabled}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    </div>
  );
}
