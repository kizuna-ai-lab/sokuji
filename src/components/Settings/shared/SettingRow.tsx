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
  /** A short mark drawn right after the label — "Beta" on a feature still settling. */
  badge?: string;
  tooltip: string;
  /**
   * A small control in the head, between the help and the switch, at the right:
   * a choice that belongs to the switch, such as the window it shows. It gives
   * way before the label wraps; what it may shrink to is its own content's say.
   * Not drawn while greyed.
   */
  accessory?: React.ReactNode;
  /** A sub-row: indented, with the └ connector. */
  sub?: boolean;
  /** The row is greyed for this reason (its title); every control in it is disabled. */
  greyed?: string;
  switch?: SettingRowSwitch;
  /** Line 2: the control, full width. */
  children?: React.ReactNode;
  /** Under the control: a line about it, such as the voice it reads in. Not drawn while greyed. */
  footer?: React.ReactNode;
  className?: string;
  id?: string;
  /**
   * `inline`: the settings page's audio rows (mock v18) — the help written
   * under the label instead of behind a help mark, the control and the switch
   * beside them. Default `stacked`: the label row, then the control.
   */
  layout?: 'stacked' | 'inline';
}

/**
 * A two-line setting row (spec 2026-10-10 D4): the label, its help tooltip
 * and, at the right edge, the switch (an accessory just before it); under
 * them the control. A greyed row says why in its title and takes no input.
 */
const SettingRow: React.FC<SettingRowProps> = ({ label, badge, tooltip, accessory, sub, greyed, switch: sw, children, footer, className = '', id, layout = 'stacked' }) => {
  const classes = ['setting-row', layout === 'inline' ? 'setting-row--inline' : '', sub ? 'setting-row--sub' : '', greyed ? 'setting-row--greyed' : '', className].filter(Boolean).join(' ');
  const toggle = sw && (
    <ToggleSwitch
      className="setting-row__switch"
      // A greyed row does nothing right now, so its switch shows off; the stored value is kept and returns when the row is live again (owner, 2026-10-11).
      checked={greyed ? false : sw.checked}
      onChange={sw.onChange}
      disabled={sw.disabled || !!greyed}
      label=""
      ariaLabel={label}
      title={greyed ?? sw.title}
      ariaDescribedBy={sw.describedBy}
    />
  );
  if (layout === 'inline') {
    return (
      <div className={classes} id={id} title={greyed} aria-disabled={greyed ? true : undefined}>
        <div className="setting-row__text">
          <span className="setting-row__label">{label}</span>
          {badge && <span className="setting-row__badge">{badge}</span>}
          <small className="setting-row__desc">{tooltip}</small>
          {footer && !greyed && footer}
        </div>
        <div className="setting-row__control">
          {children && (greyed ? <fieldset disabled className="setting-row__inert">{children}</fieldset> : children)}
          {accessory && !greyed && <span className="setting-row__accessory">{accessory}</span>}
        </div>
        {toggle || <span className="setting-row__switch-gap" aria-hidden="true" />}
      </div>
    );
  }
  return (
    <div className={classes} id={id} title={greyed} aria-disabled={greyed ? true : undefined}>
      <div className="setting-row__head">
        <span className="setting-row__label">{label}</span>
        {badge && <span className="setting-row__badge">{badge}</span>}
        <Tooltip content={tooltip} position="top" icon="help" maxWidth={300} />
        {accessory && !greyed && <span className="setting-row__accessory">{accessory}</span>}
        {toggle}
      </div>
      {children && (
        <div className="setting-row__control">
          {greyed ? <fieldset disabled className="setting-row__inert">{children}</fieldset> : children}
        </div>
      )}
      {footer && !greyed && footer}
    </div>
  );
};

export default SettingRow;
