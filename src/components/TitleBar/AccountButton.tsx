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
import { isKizunaManagedProvider } from '../../types/Provider';
import { useProvider, useTextOnly } from '../../stores/settingsStore';
import { sonioxManagedMinBalanceMicroUsd } from '../../services/providers/sonioxManagedMinBalance';
import { compactBalanceLabel } from './compactBalance';
import './AccountButton.scss';

const AccountButton: React.FC = () => {
  const { t } = useTranslation();
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const { quota } = useUserProfile();
  const provider = useProvider();
  const textOnly = useTextOnly();

  // One key, not one per state: both states name the same thing to the user.
  // Two keys holding an identical string only give a translator two chances to
  // render it differently, and a reviewer a redundancy to query.
  const accountLabel = t('titleBar.account.label', 'Account');

  if (!isSignedIn || !user) {
    return (
      <button
        type="button"
        className="title-bar__action account-button"
        title={accountLabel}
        aria-label={accountLabel}
      >
        <User size={14} />
      </button>
    );
  }

  const initial = (user.name?.[0] ?? user.email[0] ?? '?').toUpperCase();
  const balance = quota?.balance ?? quota?.remaining;

  // The low-balance warning is scoped to managed providers: a BYOK user's
  // wallet funds nothing, so warning them would be noise. E-mail verification
  // is account-level and shows regardless.
  //
  // bothSplit is deliberately omitted — the Start button derives it from
  // planBothMode(...) in MainPanel's hot path. The lower floor can only
  // under-report (no dot while Start is disabled), never show a dot while
  // Start actually works.
  const floor = sonioxManagedMinBalanceMicroUsd(Boolean(textOnly));
  const lowBalance =
    isKizunaManagedProvider(provider) && typeof balance === 'number' && balance < floor;
  const unverified = user.emailVerified === false;
  // Red outranks amber: one blocks a session, the other is a reminder.
  const tone = lowBalance ? 'low' : unverified ? 'unverified' : null;

  return (
    <button
      type="button"
      className="title-bar__action account-button"
      title={accountLabel}
      aria-label={accountLabel}
    >
      <span className="account-button__initial" aria-hidden="true">{initial}</span>
      <span className="title-bar__action-label">{compactBalanceLabel(balance)}</span>
      {tone && <span className="account-button__dot" data-tone={tone} aria-hidden="true" />}
    </button>
  );
};

export default AccountButton;
