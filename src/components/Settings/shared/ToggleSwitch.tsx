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
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  label,
  disabled = false,
  tooltip,
  tooltipMaxWidth = 300,
  className = ''
}) => {
  return (
    <div className={`toggle-switch-component ${className}`}>
      <div
        className={`toggle-switch-label ${disabled ? 'disabled' : ''}`}
        onClick={disabled ? undefined : onChange}
        role="switch"
        aria-checked={checked}
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
        <span className={`toggle-label-text ${checked ? 'active' : ''}`}>{label}</span>
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
