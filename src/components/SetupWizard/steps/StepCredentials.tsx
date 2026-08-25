import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { TUTORIAL_URLS } from '../../../services/providers/tutorialUrls';
import { openExternalUrl } from '../../../utils/openExternalUrl';
import { useAuth, useUser } from '../../../lib/auth/hooks';
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
  const { user } = useUser();
  const setAuthOverlay = useSetAuthOverlay();
  const [validating, setValidating] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // "Later" has to LEAVE the step. It reads as a button and sits beside one, so
  // a version that only set a flag looked broken — the warning it raised is on
  // the summary, a step the user only reaches by moving on (feedback 2026-08-25).
  const skipAndContinue = () => {
    dispatch({ type: 'skipCredentials' });
    dispatch({ type: 'next' });
  };
  const skip = (
    <Button variant="ghost" onClick={skipAndContinue}>
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
    // Verification is what releases the trial credit, and it happens in the
    // user's inbox — outside the app, after the account exists. A plain
    // "signed in, carry on" would send them to Start with a dead balance.
    const verified = user?.emailVerified !== false;
    return (
      <section className="setup-step">
        <h2>{t('setup.steps.credentials.managedTitle', 'Your Kizuna AI account')}</h2>
        {isSignedIn ? (
          verified
            ? <StatusMessage variant="success">{t('setup.credentials.signedIn', 'Signed in. You can continue.')}</StatusMessage>
            : <StatusMessage variant="warning">{t('setup.credentials.verifyEmail', 'Signed in. Open the link we emailed you to verify your address — the trial credit lands once you do.')}</StatusMessage>
        ) : (
          <>
            <p>{t('setup.credentials.managedDesc', 'Sign up with your email address and verify it from your inbox; verified accounts get a trial credit. After that you top up your balance and pay only for what you use.')}</p>
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
  // The live slice stands in for the provider's defaults (untouched on a fresh
  // install) and decides which slot a field writes to — Soniox keeps one key
  // per region. Read once per render rather than subscribed: nothing behind a
  // wizard that covers the app can change it while this step is on screen.
  const slice = useSettingsStore.getState()[descriptor.settingsSliceKey as keyof SettingsStore] as Record<string, unknown>;
  const fields = descriptor.credentialFieldsFor(slice);
  const tutorialUrl = TUTORIAL_URLS[provider];
  // A re-run arrives already validated, and normally the prefill below fills
  // the boxes to match. When it cannot — a provider whose validated credential
  // is not among the fields this surface renders — an empty box painted green
  // would claim a key that is not there. Say what is true instead. The slice is
  // consulted too, so the notice does not flash for the one render between the
  // re-run's first paint and the prefill landing.
  const keyOnFile = draft.credentialsValidated
    && fields.some((f) => !draft.credentials[f.key] && !slice?.[f.key]);

  const validate = async () => {
    setValidating(true);
    setMessage(null);
    try {
      // The draft overlays the slice. Nothing is written.
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
      <p>{t('setup.credentials.ownKeyDesc', 'This key is stored on this device only, and the app calls the provider straight from here — it never reaches Kizuna AI. You pay the provider for what you use.')}</p>
      <CredentialPrefill draft={draft} dispatch={dispatch} slice={slice} fieldKeys={fields.map((f) => f.key)} />
      {fields.map((f) => (
        <label key={f.key} className="setup-field">
          <span>{t(f.labelKey, f.key)}</span>
          <FormInput
            type={f.secret ? 'password' : 'text'}
            value={draft.credentials[f.key] ?? ''}
            placeholder={f.placeholderKey ? t(f.placeholderKey, '') : ''}
            onChange={(e) => dispatch({ type: 'setCredential', key: f.key, value: e.target.value })}
            status={keyOnFile ? null : draft.credentialsValidated ? 'valid' : message && !message.ok ? 'invalid' : null}
          />
        </label>
      ))}
      {keyOnFile && (
        <StatusMessage variant="info">
          {t('setup.credentials.onFile', 'A key is already saved — leave this blank to keep it.')}
        </StatusMessage>
      )}
      {tutorialUrl && (
        <a
          className="setup-link"
          href={tutorialUrl}
          onClick={(e) => { e.preventDefault(); openExternalUrl(tutorialUrl); }}
        >
          <ExternalLink size={12} />
          {t('setup.credentials.guide', 'How to get this key')}
        </a>
      )}
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

/** Mirrors the keys already in settings into the draft, once per provider.
 *  A re-run used to show empty boxes over a working key, which reads as "you
 *  never set one up" — the one thing the re-run must not claim (feedback
 *  2026-08-25). Its own component so the effect can sit above the early
 *  returns for the managed/offline paths without breaking the rules of hooks. */
const CredentialPrefill: React.FC<{
  draft: SetupDraft;
  dispatch: React.Dispatch<SetupAction>;
  slice: Record<string, unknown>;
  fieldKeys: readonly string[];
}> = ({ draft, dispatch, slice, fieldKeys }) => {
  const touched = Object.keys(draft.credentials).length > 0;
  const saved = JSON.stringify(fieldKeys.map((k) => (typeof slice?.[k] === 'string' ? slice[k] : '')));
  useEffect(() => {
    // Only while the draft is untouched for this provider: a switch of path or
    // provider clears `credentials`, which re-arms this for the new one, and a
    // keystroke (or an explicit clear, which leaves the key present but empty)
    // must never be overwritten by what is still in settings.
    // `credentialsPending` too: "Skip for now" clears the draft's credentials,
    // so a user who skipped and pressed Back would otherwise find the saved key
    // back in the box while the summary still says there is none.
    if (touched || draft.credentialsPending) return;
    const values = JSON.parse(saved) as string[];
    const credentials: Record<string, string> = {};
    fieldKeys.forEach((k, i) => { if (values[i]) credentials[k] = values[i]; });
    if (Object.keys(credentials).length > 0) dispatch({ type: 'prefillCredentials', credentials });
    // fieldKeys is a fresh array every render; `saved` carries both it and the
    // values it resolved to, as a stable string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touched, saved, dispatch, draft.credentialsPending]);
  return null;
};

export default StepCredentials;
