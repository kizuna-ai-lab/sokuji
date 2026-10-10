import React from 'react';
import Tooltip from '../../Tooltip/Tooltip';
import './ToggleSwitch.scss';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
  tooltip?: string;
  tooltipMaxWidth?: number;
  className?: string;
  /** Accessible name for the switch; needed when `label` is empty. */
  ariaLabel?: string;
  title?: string;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  label,
  disabled = false,
  tooltip,
  tooltipMaxWidth = 300,
  className = '',
  ariaLabel,
  title
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange();
    }
  };

  return (
    <div className={`toggle-switch-component ${className}`} title={title}>
      <div
        className={`toggle-switch-label ${disabled ? 'disabled' : ''}`}
        onClick={disabled ? undefined : onChange}
        onKeyDown={disabled ? undefined : handleKeyDown}
        role="switch"
        aria-label={ariaLabel}
        aria-checked={checked}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
      >
        <div className="toggle-track-container">
          <input
            type="checkbox"
            checked={checked}
            readOnly
            disabled={disabled}
            tabIndex={-1}
          />
          <span className="toggle-track" />
        </div>
        {label !== '' && <span className={`toggle-label-text ${checked ? 'active' : ''}`}>{label}</span>}
      </div>
      {tooltip && (
        <Tooltip
          content={tooltip}
          position="top"
          icon="help"
          maxWidth={tooltipMaxWidth}
        />
      )}
    </div>
  );
};

export default ToggleSwitch;
