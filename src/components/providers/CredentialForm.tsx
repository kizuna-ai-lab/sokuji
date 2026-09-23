import { CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CredentialField, CredentialValues } from '../../lib/provider/types';
import type { Readiness } from '../../stores/providerStore';

interface CredentialFormProps {
  fields: readonly CredentialField[];
  values: CredentialValues;
  readiness: Readiness;
  onChange(key: string, value: string): void;
  onCheck(): void;
}

/**
 * Any provider's credential inputs, drawn from its `credentials.fields`, with
 * the readiness check beside the last one. The markup is ProviderSection's
 * multi-field credential groups.
 */
export function CredentialForm({ fields, values, readiness, onChange, onCheck }: CredentialFormProps) {
  const { t } = useTranslation();
  const checking = readiness.state === 'checking';
  const status = readiness.state === 'ready' ? 'valid' : readiness.state === 'not-ready' ? 'invalid' : '';
  const check = (
    <button
      type="button"
      className="validate-button"
      onClick={onCheck}
      disabled={checking || fields.some((f) => !values[f.key])}
      title={t('simpleSettings.validate')}
    >
      {checking ? <span className="spinner" /> : readiness.state === 'ready' ? <CheckCircle size={16} /> : t('simpleSettings.validate')}
    </button>
  );

  return (
    <>
      {fields.length === 0 ? (
        <div className="api-key-input-group">{check}</div>
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
            />
            {i === fields.length - 1 && check}
          </div>
        ))
      )}
      {readiness.state === 'not-ready' && <div className="validation-message error">{readiness.reason}</div>}
    </>
  );
}
