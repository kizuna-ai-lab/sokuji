import { useTranslation } from 'react-i18next';
import type { CredentialChoice } from '../../lib/provider/types';

export interface CredentialChoiceControlProps {
  options: CredentialChoice['options'];
  /** The chosen option's `value`. */
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
}

/**
 * A provider's credential choice (F4): the old Palabra group's segmented
 * control (`ProviderSection.tsx:761-779`), one button per option, the chosen
 * one pressed. The one control both credential forms draw — Settings'
 * `CredentialForm` and the wizard's credential step — inside a
 * `.credential-choice-group` (`Settings.scss`).
 */
export function CredentialChoiceControl({ options, value, onChange, disabled }: CredentialChoiceControlProps) {
  const { t } = useTranslation();
  return (
    <div className="segmented-control">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`segmented-option ${o.value === value ? 'active' : ''}`.trim()}
          aria-pressed={o.value === value}
          onClick={() => { if (o.value !== value) onChange(o.value); }}
          disabled={disabled}
        >
          {t(o.labelKey)}
        </button>
      ))}
    </div>
  );
}
