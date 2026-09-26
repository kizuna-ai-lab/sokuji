import { CircleHelp } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';

/** A settings textarea's cap: the old Soniox fields' (`ProviderSpecificSettings.tsx:1841`). */
export const LINES_FIELD_MAX = 4000;

export interface LinesFieldProps {
  id: string;
  value: string;
  onChange(value: string): void;
  placeholder: string;
  disabled?: boolean;
  /** The row's label; absent, the section heading names the field and `ariaLabel` does for assistive tech. */
  label?: string;
  tooltip?: string;
  ariaLabel?: string;
  maxLength?: number;
}

/**
 * A multi-line text setting — one entry per line, or free text (F13): the
 * markup of the old Soniox vocabulary and background fields
 * (`ProviderSpecificSettings.tsx:1816-1892`), shared so a provider's own
 * settings compose it rather than copy it.
 */
export function LinesField({ id, value, onChange, placeholder, disabled = false, label, tooltip, ariaLabel, maxLength = LINES_FIELD_MAX }: LinesFieldProps) {
  return (
    <div className="setting-item">
      {label !== undefined && (
        <div className="setting-label">
          <span>{label}</span>
          {tooltip !== undefined && (
            <Tooltip content={tooltip} position="top">
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
            </Tooltip>
          )}
        </div>
      )}
      <textarea
        id={id}
        aria-label={ariaLabel ?? label}
        className="system-instructions"
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}
