/**
 * Unified user account information component that combines user profile and quota status
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {useAuth, useUser} from '../../lib/auth/hooks';
import {useUserProfile} from '../../contexts/UserProfileContext';
import {authClient} from '../../lib/auth-client';
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  LogOut,
  Mail,
  MessageCircleQuestion,
  RefreshCw,
  UserCog,
} from 'lucide-react';
import {orgDisplayBalance, orgHeldMicroUsd} from '../../lib/session/orgNotice';
import {setUseOwnBalance, useUseOwnBalance} from '../../lib/session/payerChoice';
import {
  estimateRunwayHours,
  fetchUsageSides,
  runwayAmount,
  runwayUnit,
  type UsageSide,
  type UsageSides,
} from '../../lib/wallet/usageSides';
import {formatUsd, formatUsdFloor} from '../../utils/formatters';
import {useTranslation} from 'react-i18next';
import {useAnalytics} from '../../lib/analytics';
import {reportError} from '../../lib/diagnostics/report';
import {isElectron, getBackendUrl, getApiUrl} from '../../utils/environment';
import {useSetAuthOverlay} from '../../stores/settingsStore';
import './UserAccountInfo.scss';

interface UserAccountInfoProps {
  compact?: boolean;
  /** Whether no session is running. Supplied by the popover's owner, which is the only place that reads the run. */
  idle?: boolean;
  /** The payer the running session was started with, when there is one: the panel never reads the live switch during a session. */
  runPayer?: 'organization' | 'personal';
}

export function UserAccountInfo({
                                  compact = false,
                                  idle = true,
                                  runPayer,
                                }: UserAccountInfoProps) {
  const {t} = useTranslation();
  const {trackEvent, resetUser} = useAnalytics();
  const {isLoaded, isSignedIn, getToken} = useAuth();
  const {user: betterAuthUser, refetch: refetchSession} = useUser();
  const setAuthOverlay = useSetAuthOverlay();

  // Signing out is a network round-trip. Without this the button looked
  // identical before and during the request, so the screen sat still and the
  // user had no way to tell whether their click had registered.
  const [isSigningOut, setIsSigningOut] = useState(false);

  // Get user profile and quota
  const {user, quota, isLoading: quotaLoading, error: quotaError, refetchAll} = useUserProfile();

  // isLoading starts false while quota starts null, so there is a frame — the
  // one before the effect that starts the request has even run — reading "not
  // loading, no data". Treating that as failure is what made signing in flash
  // an error row, then a spinner, then the real balance: three states for one
  // request, none of which the user asked to see.
  //
  // Derived during render, not in an effect, because an effect is exactly one
  // frame too late to prevent the flash.
  const quotaPending = quotaLoading || (!quota && !quotaError);

  if (!isLoaded) {
    return (
      <div className="user-account-loading">
        <div className="loading-spinner"/>
      </div>
    );
  }

  if (!isSignedIn || !user) {
    return null;
  }

  // Get subscription from quota data (primary source) or user data (fallback)
  // Membership is read defensively: a stale or malformed payload must degrade
  // to fewer lines, never to a crash.
  const organization = quota?.organization && typeof quota.organization.name === 'string'
    ? quota.organization
    : null;
  const personal = organization && quota?.personal && typeof quota.personal.balanceMicroUsd === 'number'
    ? quota.personal
    : null;

  // Which wallet the panel presents. Idle: the switch. Running: the payer the
  // session was STARTED with — another window can change the switch, and the
  // running session keeps what it was granted. A session started before the
  // choice existed carries none: then neither tab is truthful, so none is shown.
  const switchOn = useUseOwnBalance();
  const knownPayer: 'organization' | 'personal' | undefined = organization
    ? (idle ? (switchOn ? 'personal' : 'organization') : runPayer)
    : undefined;
  // A server that sends the organization but no personal wallet leaves the
  // switch pointing at a wallet nobody has: the panel then shows the one wallet
  // it does know rather than inventing a balance for the other.
  const useOwn = knownPayer === 'personal' && !!personal;

  // Both sides' 30-day figures, in one request, cached for five minutes. A
  // failure leaves the balances alone and hides the usage lines.
  const [sides, setSides] = useState<UsageSides | null>(null);
  const [hint, setHint] = useState<'held' | 'runway' | null>(null);
  // `useAuth().getToken` is a NEW function on every render, so putting it in the
  // callback's dependencies would give `loadSides` a new identity each render,
  // re-run the effect below, and — on a path that caches nothing (a failed
  // request) — ask the endpoint once per render. The ref keeps the latest token
  // getter without making the callback unstable.
  const getTokenRef = useRef(getToken);
  // Whose figures these are. A response is only painted while this is still the
  // identity that asked: signing in as someone else, or switching organization,
  // must not leave the previous identity's usage on screen.
  const identity = `${betterAuthUser?.id ?? user.id}|${organization?.id ?? ''}`;
  const identityRef = useRef(identity);

  // Written AFTER commit, never during render: React may replay or discard
  // render work, and a discarded render must not leave these pointing at state
  // that never committed. Declared before the effects below, so they run first.
  useEffect(() => {
    getTokenRef.current = getToken;
    identityRef.current = identity;
  });

  // The previous identity's figures go the moment the identity does; the effect
  // below then asks for the new one's.
  useEffect(() => {
    setSides(null);
    setHint(null);
  }, [identity]);

  // A request issued earlier can resolve later; only the newest one may paint.
  const requestSeq = useRef(0);
  const loadSides = useCallback(async (force: boolean) => {
    const mine = ++requestSeq.current;
    // No token means no request; a signed-out or not-yet-loaded session must not fire one.
    const token = await getTokenRef.current?.();
    if (!token) return;
    const next = await fetchUsageSides({
      apiUrl: getApiUrl(),
      token,
      userId: betterAuthUser?.id ?? user.id,
      organizationId: organization?.id,
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
      force,
    });
    if (mine !== requestSeq.current) return; // a later request superseded this one
    if (identityRef.current !== identity) return; // it answered for someone else
    if (next) setSides(next);
  }, [betterAuthUser?.id, user.id, organization?.id]);
  useEffect(() => { void loadSides(false); }, [loadSides]);

  // The side this panel is about, and the other one, whichever the tab shows.
  const shownSide: UsageSide | undefined = organization
    ? (useOwn ? sides?.personal : sides?.organization)
    : sides?.personal;
  // Before the per-side figures land (or on a server that predates them), the
  // personal side still has the polled 30-day figure. The organization's does
  // not: `last30DaysUsage` is always the CALLER's own wallet, and showing it
  // under the organization's tab would be a different number with the same name.
  const shownSpendMicroUsd = shownSide?.spendMicroUsd
    ?? (useOwn || !organization ? quota?.last30DaysUsage : undefined);

  // "No usage" and "we do not know" are different claims. The polled figure
  // covers the caller's own wallet; the organization's side only exists once
  // the endpoint answers with it, so a server that predates it must read as
  // "not available" rather than as "$0 spent".
  const personalSpend = sides?.personal?.spendMicroUsd ?? quota?.last30DaysUsage;
  const organizationSpend = sides?.organization?.spendMicroUsd;
  const totalKnown = personalSpend !== undefined && (!organization || organizationSpend !== undefined);
  const totalSpendMicroUsd = totalKnown ? (personalSpend ?? 0) + (organizationSpend ?? 0) : undefined;
  // A side whose wallet the server did not send has no balance to show — and
  // no runway either: dividing "unknown" by a rate yields a number nobody has.
  const balanceShown: number | undefined = !organization
    ? quota?.balance ?? quota?.remaining
    : useOwn
      ? personal?.balanceMicroUsd
      : orgDisplayBalance(organization);
  const availableMicroUsd = balanceShown;
  const runwayHours = shownSide && availableMicroUsd !== undefined
    ? estimateRunwayHours(availableMicroUsd, shownSide)
    : null;

  const subscription = quota?.plan || user?.subscription || 'free';

  if (compact) {
    return (
      <div className="user-account-compact">
        <div className="user-avatar">
          {betterAuthUser?.image ? (
            <img src={betterAuthUser.image} alt={user.firstName || 'User'}/>
          ) : (
            <div className="avatar-placeholder">
              {(user.firstName?.[0] || user.email[0]).toUpperCase()}
            </div>
          )}
        </div>
        <div className="user-info-compact">
          <span className="user-email">{user.email}</span>
          <span className="user-subscription">{subscription}</span>
        </div>
      </div>
    );
  }


  // State for resend verification email
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  // Tone travels WITH the message. It used to be recovered afterwards by
  // testing the rendered string for the English word "sent", so every
  // translation without that ASCII substring was styled as an error. Every
  // call site below already knows which it is; this just stops throwing that
  // knowledge away.
  type VerificationNotice = { text: string; tone: 'success' | 'error' };
  const [verificationMessage, setVerificationMessage] = useState<VerificationNotice | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  // Wall-clock anchor for the cooldown. The countdown ticks are paused while
  // the settings panel is hidden (<Activity> unmounts effects), so deriving
  // the remaining time from this anchor keeps hidden periods from
  // stretching the cooldown.
  const cooldownUntilRef = useRef<number | null>(null);

  const startCooldown = useCallback((seconds: number) => {
    cooldownUntilRef.current = Date.now() + seconds * 1000;
    setCooldownSeconds(seconds);
  }, []);

  // Check if user just signed up (within 60 seconds) and auto-start cooldown
  useEffect(() => {
    if (betterAuthUser?.createdAt && !betterAuthUser?.emailVerified) {
      const createdAt = new Date(betterAuthUser.createdAt).getTime();
      const now = Date.now();
      const secondsSinceCreation = Math.floor((now - createdAt) / 1000);

      // If user was created within last 60 seconds, start cooldown with remaining time
      if (secondsSinceCreation < 60) {
        const remainingCooldown = 60 - secondsSinceCreation;
        startCooldown(remainingCooldown);
        // Show "check your email" message for new signups
        setVerificationMessage({ text: t('auth.checkYourEmail'), tone: 'success' });
      }
    }
  }, [betterAuthUser?.createdAt, betterAuthUser?.emailVerified, t, startCooldown]);

  // Cooldown timer effect with periodic verification status check
  useEffect(() => {
    if (cooldownSeconds > 0) {
      // Remaining time comes from the wall-clock anchor, not a decrement, so
      // a panel hidden mid-countdown snaps to the true value on reveal.
      const remainingNow = () => {
        const until = cooldownUntilRef.current;
        return until === null ? 0 : Math.max(0, Math.ceil((until - Date.now()) / 1000));
      };
      // Effects remount on panel reveal: resync immediately after a hidden gap.
      if (remainingNow() < cooldownSeconds - 1) {
        setCooldownSeconds(remainingNow());
        return;
      }
      // min(prev - 1, wall clock): the guaranteed decrement means the state
      // always changes (a timer firing a few ms early would otherwise produce
      // an identical value and React's bailout would stop the tick chain),
      // while the wall clock corrects any accumulated drift downward.
      const timer = setTimeout(
        () => setCooldownSeconds((prev) => Math.max(0, Math.min(prev - 1, remainingNow()))),
        1000
      );

      // Poll verification status every 10 seconds, and at 1 second remaining
      const shouldPoll = cooldownSeconds % 10 === 0 || cooldownSeconds === 1;

      if (shouldPoll && !betterAuthUser?.emailVerified) {
        // Check verification status in background
        authClient.getSession().then((session) => {
          if (session?.data?.user?.emailVerified) {
            // User verified! Update UI immediately
            trackEvent('email_verification_completed', {});
            refetchSession?.();
            cooldownUntilRef.current = null;
            setCooldownSeconds(0);
            setVerificationMessage(null);
          }
        }).catch(() => {
          // Ignore errors during background polling
        });
      }

      return () => clearTimeout(timer);
    }
  }, [cooldownSeconds, betterAuthUser?.emailVerified, refetchSession, trackEvent]);

  // Handle resend verification email
  const handleResendVerification = async () => {
    if (isResendingVerification || cooldownSeconds > 0 || !user?.email) return;

    // Track email verification request
    trackEvent('email_verification_requested', {trigger: 'manual'});

    setIsResendingVerification(true);
    setVerificationMessage(null);

    try {
      // Step 1: Refresh session to check if already verified
      const session = await authClient.getSession();

      if (session?.data?.user?.emailVerified) {
        // Already verified - refresh local state and show message
        refetchSession?.();
        setVerificationMessage({ text: t('auth.alreadyVerified'), tone: 'success' });
        setTimeout(() => setVerificationMessage(null), 5000);
        return;
      }

      // Step 2: Not verified - send verification email
      const result = await authClient.sendVerificationEmail({
        email: user.email,
        callbackURL: window.location.origin,
      });

      // Check if request failed (Better Auth returns { error } instead of throwing)
      if (result?.error) {
        console.error('Failed to send verification email:', result.error);
        // Check if rate limited by server (status 429 or message contains "Too many")
        if (result.error.status === 429 || result.error.message?.includes('Too many')) {
          setVerificationMessage({ text: t('auth.rateLimitExceeded'), tone: 'error' });
          startCooldown(60);
          trackEvent('email_verification_failed', {error_type: 'rate_limit'});
        } else {
          setVerificationMessage({ text: t('auth.verificationEmailFailed'), tone: 'error' });
          trackEvent('email_verification_failed', {error_type: 'network'});
        }
        setTimeout(() => setVerificationMessage(null), 5000);
        return;
      }

      // Track verification email sent
      trackEvent('email_verification_sent', {});

      setVerificationMessage({ text: t('auth.verificationEmailSent'), tone: 'success' });
      startCooldown(60); // Start 60-second cooldown
      setTimeout(() => setVerificationMessage(null), 5000);
    } catch (error: any) {
      console.error('Failed to send verification email:', error);
      // Check if rate limited by server
      if (error?.status === 429 || error?.message?.includes('Too many')) {
        setVerificationMessage({ text: t('auth.rateLimitExceeded'), tone: 'error' });
        startCooldown(60);
        trackEvent('email_verification_failed', {error_type: 'rate_limit'});
      } else {
        setVerificationMessage({ text: t('auth.verificationEmailFailed'), tone: 'error' });
        trackEvent('email_verification_failed', {error_type: 'network'});
      }
      setTimeout(() => setVerificationMessage(null), 5000);
    } finally {
      setIsResendingVerification(false);
    }
  };

  // Open external URL with One-Time Token for automatic authentication
  const openExternalWithAuth = async (targetPath: string) => {
    const siteUrl = getBackendUrl();
    const apiUrl = getApiUrl();
    let url = `${siteUrl}${targetPath}`;

    // If signed in, generate OTT token for automatic login
    // Use our wrapper endpoint that calls Better Auth's verify and forwards the signed cookie
    if (isSignedIn) {
      try {
        const {data, error} = await authClient.oneTimeToken.generate();

        // A 401 here is not a token problem, it is the session being gone.
        // The likeliest way to get one: the user opened the dashboard from this
        // very panel and signed out over there, dropping the cookie the app
        // shares with it. Nothing pushes that back to the app, so without this
        // the panel goes on showing an avatar and a balance for a session the
        // server has forgotten, and every button here silently opens a login
        // page instead of the thing that was asked for.
        if ((error as {status?: number} | null)?.status === 401) {
          trackEvent('session_expired_detected', {source: 'one_time_token'});
          // Let the session hook establish the truth; the whole signed-out UI
          // — this panel, the title-bar mark, the provider notice — follows
          // from isSignedIn on its own.
          refetchSession?.();
          // The sign-in card says why it opened.
          setAuthOverlay('sign-in', 'session_expired');
          // Deliberately do NOT open the page: it would only show a login form
          // in a browser, which is neither what was asked for nor where the
          // user can act on it.
          return;
        }

        if (data?.token && !error) {
          // Use our GET wrapper endpoint that internally calls POST /api/auth/one-time-token/verify
          // The after hook sets the signed cookie, and this endpoint forwards it with redirect
          url = `${apiUrl}/ott/verify?token=${data.token}&redirect=${encodeURIComponent(targetPath)}`;
        }
        // Any other failure — the token endpoint down, a network blip — is not
        // evidence about the session. Fall through and open the plain URL.
      } catch (e) {
        // Token generation failed, use original URL (user needs to sign in manually)
        console.warn('Failed to generate OTT token:', e);
      }
    }

    // Open in system browser (Electron) or new tab (browser)
    if (isElectron() && (window as any).electron?.invoke) {
      // The promise was discarded, so a rejected invoke — main process gone,
      // handler throwing — surfaced as an unhandled rejection and nothing else.
      // Every caller of this function was affected, not just one.
      void (window as any).electron
        .invoke('open-external', url)
        .catch((e: unknown) => {
          console.warn('[UserAccountInfo] Could not open the external page:', e);
        });
    } else {
      window.open(url, '_blank');
    }
  };

  // Handle manage account click - open dashboard in system default browser
  const handleManageAccount = () => {
    trackEvent('account_management_clicked', {});
    openExternalWithAuth('/dashboard');
  };

  // The only route to money used to be the dashboard's front page, leaving
  // the user to find Billing themselves. /dashboard/billing is canonical —
  // /dashboard/wallet redirects to it.
  const handleTopUp = () => {
    trackEvent('top_up_clicked', {});
    openExternalWithAuth('/dashboard/billing');
  };

  // Handle feedback click - open feedback page in system default browser
  const handleFeedbackClick = () => {
    trackEvent('feedback_clicked', {});
    openExternalWithAuth('/dashboard/feedback');
  };

  // Handle refresh click
  const handleRefresh = () => {
    trackEvent('user_profile_refresh_clicked', {});
    refetchAll();
    // The balances and the usage figures come from different endpoints; a
    // refresh that moved one and left the other for five minutes would look
    // like the button half-worked.
    void loadSides(true);
  };

  return (
    <div className="user-account user-account-compact-layout">
      {/* Combined User Profile and Actions */}
      <div className="user-header-compact">
        <div className="user-avatar">
          {betterAuthUser?.image ? (
            <img src={betterAuthUser.image} alt={user.firstName || 'User'}/>
          ) : (
            <div className="avatar-placeholder">
              {(user.firstName?.[0] || user.email[0]).toUpperCase()}
            </div>
          )}
        </div>
        <div className="user-info">
          <h3 className="user-name">
            {user.firstName || user.lastName
              ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
              : 'User'}
          </h3>
          <p className="user-email">
            {user.email}
            {betterAuthUser?.emailVerified ? (
              <CheckCircle size={12} className="email-verified-icon" title={t('auth.emailVerified')}/>
            ) : (
              <button
                className={`email-unverified-button ${isResendingVerification || cooldownSeconds > 0 ? 'loading' : ''}`}
                onClick={handleResendVerification}
                title={cooldownSeconds > 0 ? t('auth.cooldownMessage', {seconds: cooldownSeconds}) : t('auth.emailNotVerified')}
                disabled={isResendingVerification || cooldownSeconds > 0}
              >
                <Mail size={12}/>
                <span>{isResendingVerification ? '...' : cooldownSeconds > 0 ? `${cooldownSeconds}s` : t('auth.verify')}</span>
              </button>
            )}
          </p>
        </div>
        <div className="user-actions-compact">
          <button
            className="action-button-compact feedback-button"
            onClick={handleFeedbackClick}
            title={t('feedback.title')}
          >
            <MessageCircleQuestion size={14}/>
          </button>
          <button
            className="action-button-compact manage-account"
            onClick={handleManageAccount}
            title="Manage Account"
          >
            <UserCog size={14}/>
          </button>
          <button
            className="action-button-compact sign-out"
            title="Sign Out"
            disabled={isSigningOut}
            onClick={async () => {
              if (isSigningOut) return;
              setIsSigningOut(true);
              // Track sign out click
              trackEvent('sign_out_clicked', {});
              try {
                // signOut RESOLVES with { data, error } on an HTTP failure — it
                // does not reject. better-fetch's `throw` defaults to false and
                // this client never sets it, so a 403 or 500 lands here with a
                // populated `error`, and only a transport-level failure
                // (offline, DNS) reaches the catch below. Awaiting without
                // inspecting `error` treated every rejected sign-out as a
                // success, which is also why sign_out_failed never fired for
                // anything but a dead network.
                const {error} = await authClient.signOut();
                if (error) {
                  // An error, not a warning: what the user asked for did not
                  // happen — they are still signed in and the button comes back.
                  reportError(
                    'UserAccountInfo',
                    `Sign-out refused by the server: ${error.status} ${error.statusText ?? ''}`.trim(),
                    {cause: error},
                  );
                  trackEvent('sign_out_failed', {error_code: error.status});
                } else {
                  // Track sign out success
                  trackEvent('sign_out_succeeded', {});
                  // Success path only. A failed sign-out leaves the session
                  // intact: the catch clears nothing, and the finally's cleanup
                  // works by refetching a session that signOut() has actually
                  // ended. Resetting after a failure would make a
                  // still-authenticated user report anonymously, and nothing
                  // would identify them again — identifyUser runs only from the
                  // sign-in and sign-up forms.
                  //
                  // After the success event, never before: reset() swaps in a
                  // fresh anonymous distinct_id, so an event sent afterwards
                  // would be attributed to nobody instead of to the user who
                  // just left.
                  resetUser();
                }
              } catch (error: any) {
                // Transport-level only; an HTTP error is handled above.
                console.error('Sign out error:', error);
                // Track sign out failure
                trackEvent('sign_out_failed', {error_code: error?.status});
              } finally {
                // No reload. Every piece of state it used to clear now clears
                // itself: authClient.signOut() ends the session, and the
                // profile context drops the quota when isSignedIn goes false.
                // (Before the switch, SettingsInitializer also re-validated
                // and cleared isApiKeyValid/availableModels for a managed
                // provider; the branch registers none, and SettingsInitializer
                // no longer does either — 1e-3b-2 ruling 10.) Reloading also
                // took any running translation session with it, which is the
                // whole reason this is being unwound.
                refetchSession?.();
                // On success this component goes away with the session, so
                // this matters only when signing out failed — and then the
                // user needs the button back to try again.
                setIsSigningOut(false);
              }
            }}
          >
            {isSigningOut ? <Loader2 size={14} className="spinning"/> : <LogOut size={14}/>}
          </button>
        </div>
      </div>

      {/* Email verification message */}
      {verificationMessage && (
        <div className={`verification-message ${verificationMessage.tone}`}>
          {verificationMessage.text}
        </div>
      )}

      {/* Quota Status Section */}
      <div className="quota-status-section">
        {quotaPending ? (
          <div className="quota-loading">
            <div className="loading-spinner"/>
          </div>
        ) : !quota ? (
          <div className="quota-error">
            <AlertCircle size={14}/>
            <span>{t('tokenUsage.unableToLoadQuota')}</span>
          </div>
        ) : (
          <>

            {/* The payer tabs. Members only, and only when who pays is known: a
                session started before the choice existed carries no payer, and
                neither tab would then be telling the truth. */}
            {organization && knownPayer && (
              <div className="quota-tabs" role="tablist">
                <button
                  type="button" role="tab" aria-selected={!useOwn}
                  className={`quota-tab${!useOwn ? ' is-on' : ''}`}
                  disabled={!idle}
                  onClick={() => { if (idle) setUseOwnBalance(false); }}
                >{organization.name}</button>
                {/* No personal wallet (an older server, or a wallet that failed to
                    load): offering a tab onto it would show a balance nobody has. */}
                {personal && (
                  <button
                    type="button" role="tab" aria-selected={useOwn}
                    className={`quota-tab${useOwn ? ' is-on' : ''}`}
                    disabled={!idle}
                    onClick={() => { if (idle) setUseOwnBalance(true); }}
                  >{t('tokenUsage.yourBalance')}</button>
                )}
              </div>
            )}

            {!idle && knownPayer && (
              <div className="quota-locked">
                <span className="quota-locked__dot"/>
                {t('tokenUsage.runPayer', {
                  defaultValue: 'This session is paid by {{name}}',
                  name: knownPayer === 'organization'
                    ? organization?.name ?? t('tokenUsage.yourOrganization', 'your organization')
                    : t('tokenUsage.yourBalance'),
                })}
              </div>
            )}

            {/* Two zones, labels left and figures right: the eye scans one
                column of numbers instead of reading every label. */}
            <div className="quota-rows">
              <div className="quota-row">
                <span className="quota-key">{t('tokenUsage.balance', 'Balance')}</span>
                <span className="quota-val quota-val--big">
                  {balanceShown === undefined
                    // The title bar shows no number at all here; a "$0.00" would
                    // say the wallet is empty, which is a different claim.
                    ? <span title={t('tokenUsage.usageUnavailable', 'Usage unavailable')}>—</span>
                    : formatUsdFloor(balanceShown)}
                </span>
                {organization && !useOwn && organization.frozen && (
                  <span className="quota-paused-marker">{t('tokenUsage.paused')}</span>
                )}
                {organization && useOwn && personal?.frozen && (
                  <span className="quota-paused-marker">{t('tokenUsage.paused')}</span>
                )}
              </div>

              {organization && !useOwn && (
                <div className="quota-row">
                  <span className="quota-key">{t('tokenUsage.availableBalance', 'Available')}</span>
                  <span className="quota-val">{formatUsdFloor(organization.availableMicroUsd)}</span>
                </div>
              )}

              {organization && !useOwn && orgHeldMicroUsd(organization) > 0 && (
                <div className="quota-row">
                  <span className="quota-key">
                    {t('tokenUsage.sessionHeld', 'Held by sessions')}
                    <button
                      type="button"
                      className="quota-hint"
                      aria-expanded={hint === 'held'}
                      aria-label={t('tokenUsage.heldHint', 'Sessions in progress or just finished hold part of the balance. After they settle, the unused part returns to the available balance.')}
                      onClick={() => setHint(hint === 'held' ? null : 'held')}
                    >?</button>
                  </span>
                  <span className="quota-val">{formatUsdFloor(orgHeldMicroUsd(organization))}</span>
                </div>
              )}
              {hint === 'held' && (
                <p className="quota-hint-text">
                  {t('tokenUsage.heldHint', 'Sessions in progress or just finished hold part of the balance. After they settle, the unused part returns to the available balance.')}
                </p>
              )}

              {runwayHours !== null && (
                <>
                  <div className="quota-row">
                    <span className="quota-key">
                      {t('tokenUsage.runwayLabel', 'Runway')}
                      <button
                        type="button"
                        className="quota-hint"
                        aria-expanded={hint === 'runway'}
                        aria-label={t('tokenUsage.runwayHint', 'Available balance divided by your average spend per hour over the last 30 days, measured in audio time — you will usually get longer than this.')}
                        onClick={() => setHint(hint === 'runway' ? null : 'runway')}
                      >?</button>
                    </span>
                    <span className="quota-val">
                      {t('tokenUsage.aboutDuration', {
                        defaultValue: 'about {{amount}} {{unit}}',
                        amount: runwayAmount(runwayHours),
                        unit: runwayUnit(runwayHours) === 'hour'
                          ? t('tokenUsage.unitHours', 'hours')
                          : runwayUnit(runwayHours) === 'day'
                            ? t('tokenUsage.unitDays', 'days')
                            : t('tokenUsage.unitMonths', 'months'),
                      })}
                    </span>
                  </div>
                  {hint === 'runway' && (
                    <p className="quota-hint-text">
                      {t('tokenUsage.runwayHint', 'Available balance divided by your average spend per hour over the last 30 days, measured in audio time — you will usually get longer than this.')}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="quota-zone">
              {useOwn || !organization
                ? t('tokenUsage.self30d', 'My usage · last 30 days')
                : t('tokenUsage.org30d', 'My usage in this org · last 30 days')}
            </div>
            <div className="quota-rows">
              <div className="quota-row">
                <span className="quota-key">{t('tokenUsage.spent', 'Spent')}</span>
                <span className="quota-val">
                  {shownSpendMicroUsd === undefined
                    // Not "no usage": the figure never arrived.
                    ? <span title={t('tokenUsage.usageUnavailable', 'Usage unavailable')}>—</span>
                    : shownSpendMicroUsd === 0
                      // A confirmed zero is a different claim from an unknown one.
                      ? t('tokenUsage.noUsage', 'No usage yet')
                      : formatUsd(shownSpendMicroUsd)}
                </span>
              </div>
            </div>

            <div className="quota-foot">
              <span className="quota-foot__total">
                {t('tokenUsage.total30d', '30-day total')} · {totalSpendMicroUsd !== undefined
                  ? formatUsd(totalSpendMicroUsd)
                  : <span title={t('tokenUsage.usageUnavailable', 'Usage unavailable')}>—</span>}
              </span>
              <button
                className="action-button-compact refresh-account"
                onClick={handleRefresh}
                title="Refresh"
              >
                <RefreshCw size={14}/>
              </button>
            </div>

          </>
        )}

        {/* Outside the quota branches on purpose. A failed quota load is one of
            the likeliest moments for someone to want to add funds, and burying
            the button inside the success branch left the error state offering
            no way out of it. */}
        <button className="top-up-button" onClick={handleTopUp}>
          {t('common.topUp', 'Top up')}
        </button>
      </div>

    </div>
  );
}