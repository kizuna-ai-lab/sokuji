import { AlertCircle, CheckCircle } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import type { AuthContext } from '../../lib/provider/types';
import { useSetAccountPopoverRequested } from '../../stores/settingsStore';

/**
 * A managed provider's account line under the picker, in place of a
 * credential form (spec: "Managed twins are composition" — no field):
 * today's `ProviderSection.tsx:864-906` row over the sign-in. Loading at
 * launch it shows a spinner (choice 10); signed in, that the account
 * signs the provider in; signed out, the sign-in link, which opens the
 * title bar's account popover so the sign-in lives in one place.
 */
export function ManagedAccountRow({ auth }: { auth: AuthContext }) {
  const { t } = useTranslation();
  const requestAccount = useSetAccountPopoverRequested();
  if (auth.loaded === false) {
    return (
      <div className="api-key-info">
        <span className="spinner" />
        <span>{t('update.checking', 'Checking...')}</span>
      </div>
    );
  }
  if (auth.signedIn) {
    return (
      <div className="api-key-info">
        <CheckCircle size={16} className="success-icon" />
        <span>{t('simpleSettings.autoAuthenticated', 'Automatically authenticated via your account')}</span>
      </div>
    );
  }
  return (
    <div className="api-key-warning">
      <AlertCircle size={16} className="warning-icon" />
      <span>
        <Trans
          i18nKey="common.signInRequired"
          components={{ signInLink: <button type="button" className="sign-in-link" onClick={() => requestAccount(true)} /> }}
        />
      </span>
    </div>
  );
}
