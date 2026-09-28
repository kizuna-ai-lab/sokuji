import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip/Tooltip';
import { TRANSCRIPT_MODELS, type TranscriptModel } from './settings';
import { supportsTranscriptionContext } from './transcription';

const helpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />;

export interface TranscriptionFieldProps {
  model: TranscriptModel;
  keywords: string;
  onChange(patch: { transcriptModel?: TranscriptModel; transcriptKeywords?: string }): void;
  disabled?: boolean;
}

/**
 * The source transcript's model and glossary (choice 17): the old section
 * (`ProviderSpecificSettings.tsx:886-954`), in the provider's folder — only
 * the OpenAI family has it. The glossary shows for the models that take
 * `keywords` alone: the others refuse the whole `session.update` with it.
 * The select gains an `aria-label`, as the shared fields' selects have.
 */
export function TranscriptionField({ model, keywords, onChange, disabled = false }: TranscriptionFieldProps) {
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
      {supportsTranscriptionContext(model) && (
        <div className="setting-item">
          {/* .setting-label is space-between flex, so the text and its tooltip share one child or they end up at opposite edges. */}
          <label className="setting-label" htmlFor="transcript-keywords">
            <span>
              {t('settings.transcriptKeywords', 'Transcription keywords')}
              <Tooltip
                content={t(
                  'settings.transcriptKeywordsTooltip',
                  'Names, jargon, and product terms the transcriber should be ready for, separated by commas. Hints only — a term appears in the transcript only when it is actually spoken.',
                )}
                position="top"
              >
                {helpIcon}
              </Tooltip>
            </span>
          </label>
          <input
            id="transcript-keywords"
            type="text"
            className="text-input"
            value={keywords}
            onChange={(e) => onChange({ transcriptKeywords: e.target.value })}
            placeholder={t('settings.transcriptKeywordsPlaceholder', 'Sokuji, Kizuna AI, PulseAudio')}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}
