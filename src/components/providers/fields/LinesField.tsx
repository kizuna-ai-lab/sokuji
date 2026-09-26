import { CircleHelp } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';

/** A settings textarea's cap: the old Soniox fields' (`ProviderSpecificSettings.tsx:1841`). */
export const LINES_FIELD_MAX = 4000;

interface LinesFieldCommon {
  id: string;
  value: string;
  onChange(value: string): void;
  placeholder: string;
  disabled?: boolean;
  maxLength?: number;
}

/**
 * The field always has an accessible name: its row's label, or — when the
 * section heading names it and no label row is drawn — `ariaLabel`. Never
 * both (the name read out would differ from the one shown), and a tooltip
 * only beside a label: without a label row it has nowhere to sit.
 */
export type LinesFieldProps = LinesFieldCommon & (
  | { label: string; tooltip?: string; ariaLabel?: never }
  | { ariaLabel: string; label?: never; tooltip?: never }
);

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
