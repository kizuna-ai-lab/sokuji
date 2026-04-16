import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { User, UserPlus } from 'lucide-react';
import Tooltip from '../Tooltip/Tooltip';
import type { DisplayMode } from '../../stores/settingsStore';
import './DisplayModeButton.scss';

export type DisplayScope = 'speaker' | 'participant';

interface DisplayModeButtonProps {
  scope: DisplayScope;
  value: DisplayMode;
  onChange: (next: DisplayMode) => void;
}

const CYCLE: Record<DisplayMode, DisplayMode> = {
  both: 'source',
  source: 'translation',
  translation: 'both',
};

const DisplayModeButton: React.FC<DisplayModeButtonProps> = ({ scope, value, onChange }) => {
  const { t } = useTranslation();

  const scopeLabel = t(
    scope === 'speaker' ? 'mainPanel.displayMode.speaker' : 'mainPanel.displayMode.participant',
    scope === 'speaker' ? 'Speaker' : 'Participant'
  );
  const modeLabel = useMemo(() => {
    if (value === 'both') return t('mainPanel.displayMode.both', 'Both');
    if (value === 'source') return t('mainPanel.displayMode.source', 'Src');
    return t('mainPanel.displayMode.translation', 'Trans');
  }, [value, t]);

  const tooltip = t(
    'mainPanel.displayMode.tooltip',
    '{{scope}} — click to change\nNow showing: {{mode}}\n• Src: only the original speech\n• Trans: only the translation\n• Both: both lines',
    { scope: scopeLabel, mode: modeLabel },
  );
  const ariaLabel = t(
    'mainPanel.displayMode.ariaLabel',
    '{{scope}}: {{mode}} — click to change',
    { scope: scopeLabel, mode: modeLabel },
  );

  const handleClick = useCallback(() => {
    onChange(CYCLE[value]);
  }, [onChange, value]);

  const Icon = scope === 'speaker' ? User : UserPlus;

  return (
    <Tooltip content={tooltip} icon="none" position="bottom">
      <button
        type="button"
        className="display-mode-btn"
        onClick={handleClick}
        aria-label={ariaLabel}
      >
        <Icon size={14} />
        <span className="display-mode-label">{modeLabel}</span>
      </button>
    </Tooltip>
  );
};

export default DisplayModeButton;
