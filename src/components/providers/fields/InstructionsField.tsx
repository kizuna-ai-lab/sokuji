import { useState } from 'react';
import { ChevronDown, ChevronRight, CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import type { InstructionsSettings } from '../../../lib/provider/instructions';

const helpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />;
const inlineHelpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />;

export interface InstructionsFieldProps {
  value: InstructionsSettings;
  onChange(patch: Partial<InstructionsSettings>): void;
  /** Quick mode's prompt as it will be sent for the speaker's direction. */
  preview: string;
  disabled?: boolean;
}

/**
 * A provider's own system instructions (Stage 2 Gemini, ruling 4): each
 * model has its own instruction style, so a provider's `Settings` draws
 * this over its own `S` — the old global editor's markup, Quick (the
 * template, previewed) or Advanced (the user's prompt and Other's).
 */
export function InstructionsField({ value, onChange, preview, disabled = false }: InstructionsFieldProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const otherLabel = t('settings.participantInstructions', "Other's Instructions");
  return (
    <div className="settings-section system-instructions-section" id="system-instructions-section">
      <h2>
        {t('settings.systemInstructions')}
        <Tooltip content={t('settings.systemInstructionsTooltip')} position="top">{helpIcon}</Tooltip>
      </h2>
      <div className="setting-item">
        <div className="turn-detection-options">
          <button type="button" className={`option-button ${value.useTemplateMode ? 'active' : ''}`} onClick={() => onChange({ useTemplateMode: true })} disabled={disabled}>
            {t('settings.simple')}
          </button>
          <button type="button" className={`option-button ${!value.useTemplateMode ? 'active' : ''}`} onClick={() => onChange({ useTemplateMode: false })} disabled={disabled}>
            {t('settings.advanced')}
          </button>
        </div>
      </div>
      {value.useTemplateMode ? (
        <div className="setting-item">
          <div className="setting-label">
            <span>{t('settings.preview')}</span>
            <button type="button" className="preview-toggle" aria-label={t('settings.preview')} aria-expanded={expanded} aria-controls="system-instructions-preview-content" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>
          {expanded && (
            <div id="system-instructions-preview-content" className="system-instructions-preview">
              <div className="preview-content">{preview}</div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="setting-item">
            <textarea
              className="system-instructions"
              aria-label={t('settings.systemInstructions')}
              placeholder={t('settings.enterCustomInstructions')}
              value={value.systemInstructions}
              onChange={(e) => onChange({ systemInstructions: e.target.value })}
              disabled={disabled}
            />
          </div>
          <div className="setting-item">
            <div className="setting-label">
              <span>
                {otherLabel}
                <Tooltip content={t('settings.participantInstructionsTooltip', "System instructions for translating Other's audio. Leave empty to use main instructions.")} position="top">{inlineHelpIcon}</Tooltip>
              </span>
            </div>
            <textarea
              className="system-instructions"
              aria-label={otherLabel}
              placeholder={t('settings.participantInstructionsPlaceholder', 'Leave empty to use main instructions')}
              value={value.participantSystemInstructions}
              onChange={(e) => onChange({ participantSystemInstructions: e.target.value })}
              disabled={disabled}
            />
          </div>
        </>
      )}
    </div>
  );
}
