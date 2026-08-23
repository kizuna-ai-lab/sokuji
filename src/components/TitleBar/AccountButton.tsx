// src/components/TitleBar/AccountButton.tsx
//
// Self-contained the way SubtitleEnterButton is: it reads its own stores so
// TitleBar stays a props-only component.
//
// The entry renders while SIGNED OUT too. That is the whole point of moving
// it here — an entry that only appeared after signing in would contribute
// nothing to registration.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { User } from 'lucide-react';
import { useAuth, useUser } from '../../lib/auth/hooks';
import { useUserProfile } from '../../contexts/UserProfileContext';
import { compactBalanceLabel } from './compactBalance';
import './AccountButton.scss';

const AccountButton: React.FC = () => {
  const { t } = useTranslation();
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const { quota } = useUserProfile();

  const signedOutLabel = t('titleBar.account.signedOut', 'Account');
  const signedInLabel = t('titleBar.account.signedIn', 'Account');

  if (!isSignedIn || !user) {
    return (
      <button
        type="button"
        className="title-bar__action account-button"
        title={signedOutLabel}
        aria-label={signedOutLabel}
      >
        <User size={14} />
      </button>
    );
  }

  const initial = (user.name?.[0] ?? user.email[0] ?? '?').toUpperCase();
  const balance = quota?.balance ?? quota?.remaining;

  return (
    <button
      type="button"
      className="title-bar__action account-button"
      title={signedInLabel}
      aria-label={signedInLabel}
    >
      <span className="account-button__initial" aria-hidden="true">{initial}</span>
      <span className="title-bar__action-label">{compactBalanceLabel(balance)}</span>
    </button>
  );
};

export default AccountButton;
