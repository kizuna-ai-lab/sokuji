import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { useAuth } from '../../../lib/auth/hooks';
import { useSetAuthOverlay, useSettingsStore } from '../../../stores/settingsStore';
import type { SettingsStore } from '../../../stores/settingsStore';
import Button from '../../Settings/shared/Button';
import FormInput from '../../Settings/shared/FormInput';
import StatusMessage from '../../Settings/shared/StatusMessage';
import type { SetupAction, SetupDraft } from '../setupDraft';

interface Props { draft: SetupDraft; dispatch: React.Dispatch<SetupAction> }

const StepCredentials: React.FC<Props> = ({ draft, dispatch }) => {
  const { t } = useTranslation();
  const { isSignedIn, getToken } = useAuth();
  const setAuthOverlay = useSetAuthOverlay();
  const [validating, setValidating] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const skip = (
    <Button variant="ghost" onClick={() => dispatch({ type: 'skipCredentials' })}>
      {t('setup.skipForNow', 'Skip for now')}
    </Button>
  );

  if (draft.providerPath === 'offline') {
    return (
      <section className="setup-step">
        <h2>{t('setup.steps.credentials.offlineTitle', 'Nothing to enter')}</h2>
        <StatusMessage variant="info">
          {t('setup.credentials.offlineNotice', 'Models are downloaded after setup, from Settings. They take gigabytes of disk. Sokuji runs well with a GPU and enough VRAM; on CPU alone it is noticeably slower.')}
        </StatusMessage>
      </section>
    );
  }

  if (draft.providerPath === 'managed') {
    return (
      <section className="setup-step">
        <h2>{t('setup.steps.credentials.managedTitle', 'Your Kizuna AI account')}</h2>
        {isSignedIn ? (
          <StatusMessage variant="success">{t('setup.credentials.signedIn', 'Signed in. You can continue.')}</StatusMessage>
        ) : (
          <>
            <p>{t('setup.credentials.managedDesc', 'Sign in or create an account. Translation is billed from your balance; new accounts get a trial credit.')}</p>
            <div className="setup-actions">
              <Button variant="primary" onClick={() => setAuthOverlay('sign-in')}>{t('setup.credentials.signIn', 'Sign in')}</Button>
              <Button variant="secondary" onClick={() => setAuthOverlay('sign-up')}>{t('setup.credentials.createAccount', 'Create account')}</Button>
              {skip}
            </div>
            {draft.credentialsPending && <StatusMessage variant="warning">{t('setup.credentials.pendingSignIn', 'You can sign in later from the account button. Start stays locked until then.')}</StatusMessage>}
          </>
        )}
      </section>
    );
  }

  // own-key
  const provider = draft.provider!;
  const descriptor = ProviderConfigFactory.getDescriptor(provider);
  const fields = descriptor.credentialFields;

  const validate = async () => {
    setValidating(true);
    setMessage(null);
    try {
      // The live slice stands in for the provider's defaults (untouched on a
      // fresh install); the draft overlays it. Nothing is written.
      const slice = useSettingsStore.getState()[descriptor.settingsSliceKey as keyof SettingsStore] as Record<string, unknown>;
      const creds = await descriptor.extractCredentials({ ...slice, ...draft.credentials }, { getAuthToken: getToken });
      if (!creds.ok) { setMessage({ ok: false, text: creds.missing }); return; }
      const { validation } = await descriptor.validateAndFetchModels(creds);
      if (validation.valid) {
        dispatch({ type: 'credentialsValidated' });
        setMessage({ ok: true, text: t('setup.credentials.valid', 'Key accepted.') });
      } else {
        setMessage({ ok: false, text: validation.message || t('setup.credentials.invalid', 'The key was rejected.') });
      }
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setValidating(false);
    }
  };

  return (
    <section className="setup-step">
      <h2>{t('setup.steps.credentials.ownKeyTitle', 'Your API key')}</h2>
      {fields.map((f) => (
        <label key={f.key} className="setup-field">
          <span>{t(f.labelKey, f.key)}</span>
          <FormInput
            type={f.secret ? 'password' : 'text'}
            value={draft.credentials[f.key] ?? ''}
            placeholder={f.placeholderKey ? t(f.placeholderKey, '') : ''}
            onChange={(e) => dispatch({ type: 'setCredential', key: f.key, value: e.target.value })}
            status={draft.credentialsValidated ? 'valid' : message && !message.ok ? 'invalid' : null}
          />
        </label>
      ))}
      <div className="setup-actions">
        <Button variant="primary" onClick={validate} loading={validating} disabled={validating || fields.some((f) => !draft.credentials[f.key])}>
          {t('setup.credentials.validate', 'Validate')}
        </Button>
        {skip}
      </div>
      {message && <StatusMessage variant={message.ok ? 'success' : 'error'}>{message.text}</StatusMessage>}
      {draft.credentialsPending && <StatusMessage variant="warning">{t('setup.credentials.pendingKey', 'You can add the key later in Settings → Provider. Start stays locked until it validates.')}</StatusMessage>}
    </section>
  );
};

export default StepCredentials;
