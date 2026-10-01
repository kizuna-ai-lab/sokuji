import { CircleHelp, ExternalLink } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';
import { openExternalUrl } from '../../../utils/openExternalUrl';

export interface TextFieldProps {
  id: string;
  /** The row's label, and the input's accessible name. */
  label: string;
  tooltip?: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  /** A page to manage what the field names (Doubao's console libraries), opened outside the app. */
  link?: { href: string; label: string };
}

/**
 * A single-line text setting (F13; Stage 2 Volcengine AST2): the markup of
 * the old Doubao AST 2.0 library-id rows (`ProviderSpecificSettings.tsx:1606-1686`)
 * — a label, its tooltip, a right-aligned external link, the input —
 * shared so a provider's own settings compose it rather than copy it.
 * `LinesField` is its multi-line sibling.
 */
export function TextField({ id, label, tooltip, value, onChange, disabled = false, link }: TextFieldProps) {
  return (
    <div className="setting-item">
      <div className="setting-label">
        <span>{label}</span>
        {tooltip !== undefined && (
          <Tooltip content={tooltip} position="top">
            <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
          </Tooltip>
        )}
        {link && (
          <div className="tutorial-link" style={{ margin: 0, marginLeft: 'auto' }}>
            <a href={link.href} onClick={(e) => { e.preventDefault(); openExternalUrl(link.href); }}>
              <ExternalLink size={12} />
              {link.label}
            </a>
          </div>
        )}
      </div>
      <input
        id={id}
        type="text"
        className="text-input"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder=""
      />
    </div>
  );
}
