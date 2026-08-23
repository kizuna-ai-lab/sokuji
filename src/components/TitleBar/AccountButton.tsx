// src/components/TitleBar/AccountButton.tsx
//
// Self-contained the way SubtitleEnterButton is: it reads its own stores so
// TitleBar stays a props-only component.
//
// The entry renders while SIGNED OUT too. That is the whole point of moving
// it here — an entry that only appeared after signing in would contribute
// nothing to registration.
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from 'lucide-react';
import { useAuth, useUser } from '../../lib/auth/hooks';
import { useUserProfile } from '../../contexts/UserProfileContext';
import { isKizunaAIEnabled } from '../../utils/environment';
import { isKizunaManagedProvider } from '../../types/Provider';
import {
  useProvider,
  useTextOnly,
  useAccountPopoverRequested,
  useSetAccountPopoverRequested,
} from '../../stores/settingsStore';
import { sonioxManagedMinBalanceMicroUsd } from '../../services/providers/sonioxManagedMinBalance';
import { compactBalanceLabel } from './compactBalance';
import { useVerificationRefresh } from './useVerificationRefresh';
import { useToast } from '../Toast';
import AccountPopover from './AccountPopover';
import './AccountButton.scss';

const AccountButton: React.FC = () => {
  const { t } = useTranslation();
  const { isSignedIn } = useAuth();
  const { user, refetch } = useUser();
  const { showToast } = useToast();
  const { quota } = useUserProfile();
  const provider = useProvider();
  const textOnly = useTextOnly();
  const [open, setOpen] = useState(false);
  // The popover anchors to the button's own element, so the anchor never
  // travels between components. It is null on the first render and set by the
  // time the click-triggered re-render opens the popover.
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Other surfaces can ask for this popover instead of growing a sign-in
  // affordance of their own — the provider section's sign-in notice does. The
  // request is consumed on arrival: leaving it raised would re-open the
  // popover on the next render and make it impossible to close.
  const popoverRequested = useAccountPopoverRequested();
  const setPopoverRequested = useSetAccountPopoverRequested();
  useEffect(() => {
    if (popoverRequested) {
      setOpen(true);
      setPopoverRequested(false);
    }
  }, [popoverRequested, setPopoverRequested]);

  // Verification is finished in a BROWSER, so the app only learns about it when
  // the user comes back. The old polling ran solely during the 60-second resend
  // cooldown, and it now lives in a component mounted only while the popover is
  // open — this button is always mounted, so the listener belongs here.
  useVerificationRefresh(isSignedIn, user?.emailVerified === true, refetch);

  // Confirm it happened — otherwise the only feedback is a warning
  // disappearing, which is not feedback.
  //
  // Tri-state on purpose. `undefined` means "no user loaded yet", which is what
  // every launch looks like while the session resolves; only an observed FALSE
  // counts as having seen an unverified account. Seeding this from a mere
  // absence of a user would congratulate the user on verifying at every start.
  const wasVerified = useRef<boolean | undefined>(user?.emailVerified);
  useEffect(() => {
    const now = user?.emailVerified;
    if (wasVerified.current === false && now === true) {
      showToast(t('auth.emailVerifiedToast', 'E-mail verified'), { variant: 'success' });
    }
    wasVerified.current = now;
  }, [user?.emailVerified, showToast, t]);

  // A build with the Kizuna gate closed registers no managed provider and has
  // no wallet, so an account buys nothing there — offering to register would
  // promise a service the build does not contain. AccountSection carried this
  // same guard before it was removed; it has to survive the move, not be lost
  // in it. Placed after every hook call so the hook order stays unconditional.
  if (!isKizunaAIEnabled()) return null;

  // One key, not one per state: both states name the same thing to the user.
  // Two keys holding an identical string only give a translator two chances to
  // render it differently, and a reviewer a redundancy to query.
  const accountLabel = t('titleBar.account.label', 'Account');

  // The two sign-in states differ only in the button's label and its contents:
  // one button element, one popover, mounted once. Returning a whole button
  // plus a popover from each branch would mount the popover twice.
  let label: string;
  let content: React.ReactNode;

  if (!isSignedIn || !user) {
    // Labelled, like every neighbour in this bar. A bare glyph between two
    // labelled buttons reads as a missing label, and says nothing about what
    // the click does — on the one control whose whole job is to be found by
    // someone who has not signed up yet. The label doubles as the accessible
    // name so the two never disagree ("label in name").
    label = t('common.signIn', 'Sign In');
    content = (
      <>
        <User size={14} />
        <span className="title-bar__action-label">{label}</span>
      </>
    );
  } else {
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

    // The dot is aria-hidden, so the state has to reach a screen reader through
    // the label or its early-warning value simply does not exist for one. It
    // doubles as the hover tooltip, which tells sighted users WHY the dot is
    // there instead of leaving them to guess.
    label =
      tone === 'low'
        ? t('titleBar.account.lowBalance', 'Account — balance too low to start a session')
        : tone === 'unverified'
          ? t('titleBar.account.unverified', 'Account — e-mail not verified')
          : accountLabel;

    content = (
      <>
        <span className="account-button__initial" aria-hidden="true">{initial}</span>
        <span className="title-bar__action-label">{compactBalanceLabel(balance)}</span>
        {tone && <span className="account-button__dot" data-tone={tone} aria-hidden="true" />}
      </>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="title-bar__action account-button"
        title={label}
        aria-label={label}
        // The button is not floating-ui's managed reference in this split, so
        // useRole cannot wire these two for us — they are written by hand.
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {content}
      </button>
      <AccountPopover open={open} anchorEl={btnRef.current} onClose={() => setOpen(false)} />
    </>
  );
};

export default AccountButton;
