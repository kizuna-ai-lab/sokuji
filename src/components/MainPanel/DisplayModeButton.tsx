import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Users } from 'lucide-react';
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
    scope === 'speaker' ? 'Me' : 'Them'
  );
  const modeLabel = useMemo(() => {
    if (value === 'both') return t('mainPanel.displayMode.both', 'Both');
    if (value === 'source') return t('mainPanel.displayMode.source', 'Src');
    return t('mainPanel.displayMode.translation', 'Trans');
  }, [value, t]);

  const tooltip = t('mainPanel.displayMode.tooltip', '{{scope}}: {{mode}} — click to change', {
    scope: scopeLabel,
    mode: modeLabel,
  });

  const handleClick = useCallback(() => {
    onChange(CYCLE[value]);
  }, [onChange, value]);

  const Icon = scope === 'speaker' ? Mic : Users;

  return (
    <Tooltip content={tooltip} icon="none" position="bottom">
      <button
        type="button"
        className="display-mode-btn"
        onClick={handleClick}
        aria-label={tooltip}
      >
        <Icon size={14} />
        <span className="display-mode-label">{modeLabel}</span>
      </button>
    </Tooltip>
  );
};

export default DisplayModeButton;
