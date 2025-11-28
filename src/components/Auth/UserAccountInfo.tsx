/**
 * Unified user account information component that combines user profile and quota status
 */

import {useEffect, useState} from 'react';
import {useAuth, useUser} from '../../lib/auth/hooks';
import {useUserProfile} from '../../contexts/UserProfileContext';
import {authClient} from '../../lib/auth-client';
import {
  AlertCircle,
  CheckCircle,
  LogOut,
  Mail,
  MessageCircleQuestion,
  RefreshCw,
  TrendingDown,
  UserCog,
  Wallet
} from 'lucide-react';
import {formatTokens} from '../../utils/formatters';
import {useTranslation} from 'react-i18next';
import {useAnalytics} from '../../lib/analytics';
import {isElectron, getBackendUrl, getApiUrl} from '../../utils/environment';
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

  // Get user profile and quota
  const {user, quota, isLoading: quotaLoading, refetchAll} = useUserProfile();

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
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // Check if user just signed up (within 60 seconds) and auto-start cooldown
  useEffect(() => {
    if (betterAuthUser?.createdAt && !betterAuthUser?.emailVerified) {
      const createdAt = new Date(betterAuthUser.createdAt).getTime();
      const now = Date.now();
      const secondsSinceCreation = Math.floor((now - createdAt) / 1000);

      // If user was created within last 60 seconds, start cooldown with remaining time
      if (secondsSinceCreation < 60) {
        const remainingCooldown = 60 - secondsSinceCreation;
        setCooldownSeconds(remainingCooldown);
        // Show "check your email" message for new signups
        setVerificationMessage(t('auth.checkYourEmail'));
      }
    }
  }, [betterAuthUser?.createdAt, betterAuthUser?.emailVerified, t]);

  // Cooldown timer effect with periodic verification status check
  useEffect(() => {
    if (cooldownSeconds > 0) {
      const timer = setTimeout(() => setCooldownSeconds(cooldownSeconds - 1), 1000);

      // Poll verification status every 10 seconds, and at 1 second remaining
      const shouldPoll = cooldownSeconds % 10 === 0 || cooldownSeconds === 1;

      if (shouldPoll && !betterAuthUser?.emailVerified) {
        // Check verification status in background
        authClient.getSession().then((session) => {
          if (session?.data?.user?.emailVerified) {
            // User verified! Update UI immediately
            trackEvent('email_verification_completed', {});
            refetchSession?.();
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
        setVerificationMessage(t('auth.alreadyVerified'));
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
          setVerificationMessage(t('auth.rateLimitExceeded'));
          setCooldownSeconds(60);
          trackEvent('email_verification_failed', {error_type: 'rate_limit'});
        } else {
          setVerificationMessage(t('auth.verificationEmailFailed'));
          trackEvent('email_verification_failed', {error_type: 'network'});
        }
        setTimeout(() => setVerificationMessage(null), 5000);
        return;
      }

      // Track verification email sent
      trackEvent('email_verification_sent', {});

      setVerificationMessage(t('auth.verificationEmailSent'));
      setCooldownSeconds(60); // Start 60-second cooldown
      setTimeout(() => setVerificationMessage(null), 5000);
    } catch (error: any) {
      console.error('Failed to send verification email:', error);
      // Check if rate limited by server
      if (error?.status === 429 || error?.message?.includes('Too many')) {
        setVerificationMessage(t('auth.rateLimitExceeded'));
        setCooldownSeconds(60);
        trackEvent('email_verification_failed', {error_type: 'rate_limit'});
      } else {
        setVerificationMessage(t('auth.verificationEmailFailed'));
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
        if (data?.token && !error) {
          // Use our GET wrapper endpoint that internally calls POST /api/auth/one-time-token/verify
          // The after hook sets the signed cookie, and this endpoint forwards it with redirect
          url = `${apiUrl}/ott/verify?token=${data.token}&redirect=${encodeURIComponent(targetPath)}`;
        }
      } catch (e) {
        // Token generation failed, use original URL (user needs to sign in manually)
        console.warn('Failed to generate OTT token:', e);
      }
    }

    // Open in system browser (Electron) or new tab (browser)
    if (isElectron() && (window as any).electron?.invoke) {
      (window as any).electron.invoke('open-external', url);
    } else {
      window.open(url, '_blank');
    }
  };

  // Handle manage account click - open dashboard in system default browser
  const handleManageAccount = () => {
    trackEvent('account_management_clicked', {});
    openExternalWithAuth('/dashboard');
  };

  // Handle feedback click - open feedback page in system default browser
  const handleFeedbackClick = () => {
    trackEvent('feedback_clicked', {});
    openExternalWithAuth('/dashboard/feedback');
  };

  // Handle manage subscription click - navigate to subscription management
  const handleManageSubscriptionClick = () => {
    // Track subscription management click
    trackEvent('subscription_management_clicked', {});
    // TODO: Implement subscription management page or link to backend billing page
    console.log('Manage subscription clicked - implement subscription management');
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
            onClick={async () => {
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
                // Force page reload to clear all state
                window.location.href = '/';
              }
            }}
          >
            <LogOut size={14}/>
          </button>
        </div>
      </div>

      {/* Email verification message */}
      {verificationMessage && (
        <div className={`verification-message ${verificationMessage.includes('sent') ? 'success' : 'error'}`}>
          {verificationMessage}
        </div>
      )}

      {/* Quota Status Section */}
      <div className="quota-status-section">
        {quotaLoading ? (
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
              <span className={`plan-badge plan-badge-${subscription}`}>
                {subscription.toUpperCase()}
              </span>
              <span className="divider">|</span>
              <Wallet size={14} className="wallet-icon"/>
              <span className="balance-section">
                {formatTokens(quota.balance || quota.remaining)} tokens
              </span>
              <span className="divider">|</span>
              <span className="usage-section">
                <TrendingDown size={14} className="usage-icon"/>
                30D: {formatTokens(quota.last30DaysUsage || 0)}
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
      </div>

      {subscription === 'free' && (
        <div className="upgrade-section">
          <button
            className="upgrade-button"
            onClick={handleManageSubscriptionClick}
          >
            {t('tokenUsage.upgradeToPremium')}
          </button>
        </div>
      )}

    </div>
  );
}