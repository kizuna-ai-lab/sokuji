/**
 * Unified user account information component that combines user profile and quota status
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {useAuth, useUser} from '../../lib/auth/hooks';
import {useUserProfile} from '../../contexts/UserProfileContext';
import {authClient} from '../../lib/auth-client';
import {
  AlertCircle,
  ChartColumn,
  CheckCircle,
  Loader2,
  LogOut,
  Mail,
  MessageCircleQuestion,
  RefreshCw,
  UserCog,
  Wallet
} from 'lucide-react';
import {formatUsd, formatUsdFloor} from '../../utils/formatters';
import {useTranslation} from 'react-i18next';
import {useAnalytics} from '../../lib/analytics';
import {isElectron, getBackendUrl, getApiUrl} from '../../utils/environment';
import {useToast} from '../Toast';
import {useSetAuthOverlay} from '../../stores/settingsStore';
import './UserAccountInfo.scss';

interface UserAccountInfoProps {
  compact?: boolean;
}

export function UserAccountInfo({
                                  compact = false,
                                }: UserAccountInfoProps) {
  const {t} = useTranslation();
  const {trackEvent} = useAnalytics();
  const {isLoaded, isSignedIn} = useAuth();
  const {user: betterAuthUser, refetch: refetchSession} = useUser();
  const {showToast} = useToast();
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
          showToast(
            t('auth.sessionExpired', 'Your session has expired. Please sign in again.'),
            {variant: 'error'},
          );
          setAuthOverlay('sign-in');
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
                await authClient.signOut();
                // Track sign out success
                trackEvent('sign_out_succeeded', {});
              } catch (error: any) {
                console.error('Sign out error:', error);
                // Track sign out failure
                trackEvent('sign_out_failed', {error_code: error?.status});
                // Even if backend returns 403 or other errors, clear frontend state
                // This ensures users can always "log out"
              } finally {
                // No reload. Every piece of state it used to clear now clears
                // itself: authClient.signOut() ends the session, the profile
                // context drops the quota when isSignedIn goes false, and
                // SettingsInitializer re-validates and clears isApiKeyValid and
                // availableModels for a managed provider. Reloading also took
                // any running translation session with it, which is the whole
                // reason this is being unwound.
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

            <div className="quota-compact-line">
              <Wallet size={14} className="wallet-icon"/>
              <span className="balance-section">
                {/* Floored, not rounded: a balance must never display more
                    money than the wallet holds. See `formatUsdFloor`. */}
                {formatUsdFloor(quota.balance || quota.remaining)}
              </span>
              <span className="divider">|</span>
              <span className="usage-section">
                <ChartColumn size={14} className="usage-icon"/>
                30D: {formatUsd(quota.last30DaysUsage || 0)}
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