import { CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CredentialChoice, CredentialField, CredentialValues } from '../../lib/provider/types';
import type { Readiness } from '../../stores/providerStore';
import { noticeText } from '../../lib/view/noticeText';
import { CredentialChoiceControl } from './CredentialChoiceControl';

interface CredentialFormProps {
  fields: readonly CredentialField[];
  values: CredentialValues;
  readiness: Readiness;
  onChange(key: string, value: string): void;
  /** Absent: no check button — a local provider checks itself. */
  onCheck?(): void;
  disabled?: boolean;
  /** The provider's credential choice (F4), drawn above the fields: its options, the setting's current value, and how to change it. */
  choice?: { options: CredentialChoice['options']; value: string; onChange(value: string): void };
}

/**
 * Any provider's credential inputs, drawn from its `credentials.fields`, with
 * the readiness check beside the last one. The markup is ProviderSection's
 * multi-field credential groups; a credential choice (F4) is its Palabra
 * group's segmented control above them (`CredentialChoiceControl`).
 */
export function CredentialForm({ fields, values, readiness, onChange, onCheck, disabled, choice }: CredentialFormProps) {
  const { t } = useTranslation();
  const checking = readiness.state === 'checking';
  const status = readiness.state === 'ready' ? 'valid' : readiness.state === 'not-ready' ? 'invalid' : '';
  const check = onCheck && (
    <button
      type="button"
      className="validate-button"
      onClick={onCheck}
      disabled={disabled || checking || fields.some((f) => !values[f.key])}
      title={t('simpleSettings.validate')}
    >
      {checking ? <span className="spinner" /> : readiness.state === 'ready' ? <CheckCircle size={16} /> : t('simpleSettings.validate')}
    </button>
  );

  const form = (
    <>
      {fields.length === 0 ? (
        check && <div className="api-key-input-group">{check}</div>
      ) : (
        fields.map((f, i) => (
          <div className="api-key-input-group" key={f.key}>
            <input
              type={f.secret ? 'password' : 'text'}
              value={values[f.key] ?? ''}
              onChange={(e) => onChange(f.key, e.target.value)}
              placeholder={t(f.placeholderKey ?? f.labelKey, f.key)}
              aria-label={t(f.labelKey, f.key)}
              className={`api-key-input ${status}`.trim()}
              disabled={disabled}
            />
            {i === fields.length - 1 && check}
          </div>
        ))
      )}
      {readiness.state === 'not-ready' && (
        <div className="validation-message error">{noticeText(t, { code: readiness.code, params: readiness.params, message: readiness.reason })}</div>
      )}
    </>
  );
  if (!choice) return form;
  return (
    <div className="credential-choice-group">
      <CredentialChoiceControl options={choice.options} value={choice.value} onChange={choice.onChange} disabled={disabled} />
      {form}
    </div>
  );
}
