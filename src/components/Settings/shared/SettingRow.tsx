// src/components/Settings/shared/SettingRow.tsx
import React from 'react';
import Tooltip from '../../Tooltip/Tooltip';
import ToggleSwitch from './ToggleSwitch';

export interface SettingRowSwitch {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** Why the switch is disabled while the row is not greyed (a run froze it). */
  title?: string;
  /** Id of the line that says why the switch is blocked. */
  describedBy?: string;
}

export interface SettingRowProps {
  label: string;
  tooltip: string;
  /** A sub-row: indented, with the └ connector. */
  sub?: boolean;
  /** The row is greyed for this reason (its title); every control in it is disabled. */
  greyed?: string;
  switch?: SettingRowSwitch;
  /** Line 2: the control, full width. */
  children?: React.ReactNode;
  className?: string;
  id?: string;
}

/**
 * A two-line setting row (spec 2026-10-10 D4): the label, its help tooltip
 * and, at the right edge, the switch; under them the control. A greyed row
 * says why in its title and takes no input.
 */
const SettingRow: React.FC<SettingRowProps> = ({ label, tooltip, sub, greyed, switch: sw, children, className = '', id }) => {
  const classes = ['setting-row', sub ? 'setting-row--sub' : '', greyed ? 'setting-row--greyed' : '', className].filter(Boolean).join(' ');
  return (
    <div className={classes} id={id} title={greyed} aria-disabled={greyed ? true : undefined}>
      <div className="setting-row__head">
        <span className="setting-row__label">{label}</span>
        <Tooltip content={tooltip} position="top" icon="help" maxWidth={300} />
        {sw && (
          <ToggleSwitch
            className="setting-row__switch"
            checked={sw.checked}
            onChange={sw.onChange}
            disabled={sw.disabled || !!greyed}
            label=""
            ariaLabel={label}
            title={greyed ?? sw.title}
            ariaDescribedBy={sw.describedBy}
          />
        )}
      </div>
      {children && (
        <div className="setting-row__control">
          {greyed ? <fieldset disabled className="setting-row__inert">{children}</fieldset> : children}
        </div>
      )}
    </div>
  );
};

export default SettingRow;
