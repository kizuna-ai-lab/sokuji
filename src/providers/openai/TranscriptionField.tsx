import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip/Tooltip';
import { TRANSCRIPT_MODELS, type TranscriptModel } from './settings';

const helpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />;

export interface TranscriptionFieldProps {
  model: TranscriptModel;
  onChange(patch: { transcriptModel?: TranscriptModel }): void;
  disabled?: boolean;
}

/**
 * The source transcript's model (choice 17), in the provider's folder — only the OpenAI family has it. Its keywords
 * are the app's word list now (`buildTranscriptionHint`). The select has an `aria-label`, as the shared fields'
 * selects have.
 */
export function TranscriptionField({ model, onChange, disabled = false }: TranscriptionFieldProps) {
  const { t } = useTranslation();
  return (
    <div className="settings-section">
      <h2>
        {t('settings.userTranscriptModel')}
        <Tooltip content={t('settings.transcriptModelTooltip')} position="top">{helpIcon}</Tooltip>
      </h2>
      <div className="setting-item">
        <select className="select-dropdown" aria-label={t('settings.userTranscriptModel')} value={model} onChange={(e) => onChange({ transcriptModel: e.target.value as TranscriptModel })} disabled={disabled}>
          {TRANSCRIPT_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
    </div>
  );
}
