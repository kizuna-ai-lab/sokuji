/**
 * Unified user account information component that combines user profile and quota status
 */

import {useEffect, useState} from 'react';
import {useAuth, useUser} from '../../lib/auth/hooks';
import {useUserProfile} from '../../contexts/UserProfileContext';
import {authClient} from '../../lib/auth-client';
import {AlertCircle, CheckCircle, LogOut, Mail, RefreshCw, TrendingDown, UserCog, Wallet} from 'lucide-react';
import {formatTokens} from '../../utils/formatters';
import {useTranslation} from 'react-i18next';
import './UserAccountInfo.scss';

interface UserAccountInfoProps {
  compact?: boolean;
}

export function UserAccountInfo({
  compact = false
}: UserAccountInfoProps) {
  const { t } = useTranslation();
  const { isLoaded, isSignedIn } = useAuth();
  const { user: betterAuthUser, refetch: refetchSession } = useUser();

  // Get user profile and quota
  const { user, quota, isLoading: quotaLoading, refetchAll } = useUserProfile();

  if (!isLoaded) {
    return (
      <div className="user-account-loading">
        <div className="loading-spinner" />
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
            <img src={betterAuthUser.image} alt={user.firstName || 'User'} />
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
  }, [cooldownSeconds, betterAuthUser?.emailVerified, refetchSession]);

  // Handle resend verification email
  const handleResendVerification = async () => {
    if (isResendingVerification || cooldownSeconds > 0 || !user?.email) return;

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
        } else {
          setVerificationMessage(t('auth.verificationEmailFailed'));
        }
        setTimeout(() => setVerificationMessage(null), 5000);
        return;
      }

      setVerificationMessage(t('auth.verificationEmailSent'));
      setCooldownSeconds(60); // Start 60-second cooldown
      setTimeout(() => setVerificationMessage(null), 5000);
    } catch (error: any) {
      console.error('Failed to send verification email:', error);
      // Check if rate limited by server
      if (error?.status === 429 || error?.message?.includes('Too many')) {
        setVerificationMessage(t('auth.rateLimitExceeded'));
        setCooldownSeconds(60);
      } else {
        setVerificationMessage(t('auth.verificationEmailFailed'));
      }
      setTimeout(() => setVerificationMessage(null), 5000);
    } finally {
      setIsResendingVerification(false);
    }
  };

  // Handle manage account click - navigate to account management (could be external or custom page)
  const handleManageAccount = () => {
    // TODO: Implement account management page or link to backend account page
    console.log('Manage account clicked - implement account management');
  };

  // Handle manage subscription click - navigate to subscription management
  const handleManageSubscriptionClick = () => {
    // TODO: Implement subscription management page or link to backend billing page
    console.log('Manage subscription clicked - implement subscription management');
  };

  return (
    <div className="user-account user-account-compact-layout">
      {/* Combined User Profile and Actions */}
      <div className="user-header-compact">
        <div className="user-avatar">
          {betterAuthUser?.image ? (
            <img src={betterAuthUser.image} alt={user.firstName || 'User'} />
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
              <CheckCircle size={12} className="email-verified-icon" title={t('auth.emailVerified')} />
            ) : (
              <button
                className={`email-unverified-button ${isResendingVerification || cooldownSeconds > 0 ? 'loading' : ''}`}
                onClick={handleResendVerification}
                title={cooldownSeconds > 0 ? t('auth.cooldownMessage', { seconds: cooldownSeconds }) : t('auth.emailNotVerified')}
                disabled={isResendingVerification || cooldownSeconds > 0}
              >
                <Mail size={12} />
                <span>{isResendingVerification ? '...' : cooldownSeconds > 0 ? `${cooldownSeconds}s` : t('auth.verify')}</span>
              </button>
            )}
          </p>
        </div>
        <div className="user-actions-compact">
          <button
            className="action-button-compact manage-account"
            onClick={handleManageAccount}
            title="Manage Account"
          >
            <UserCog size={14} />
          </button>
          <button
            className="action-button-compact sign-out"
            title="Sign Out"
            onClick={async () => {
              try {
                await authClient.signOut();
              } catch (error) {
                console.error('Sign out error:', error);
                // Even if backend returns 403 or other errors, clear frontend state
                // This ensures users can always "log out"
              } finally {
                // Force page reload to clear all state
                window.location.href = '/';
              }
            }}
          >
            <LogOut size={14} />
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
            <div className="loading-spinner" />
          </div>
        ) : !quota ? (
          <div className="quota-error">
            <AlertCircle size={14} />
            <span>{t('tokenUsage.unableToLoadQuota')}</span>
          </div>
        ) : (
          <>

            <div className="quota-compact-line">
              <span className={`plan-badge plan-badge-${subscription}`}>
                {subscription.toUpperCase()}
              </span>
              <span className="divider">|</span>
              <Wallet size={14} className="wallet-icon" />
              <span className="balance-section">
                {formatTokens(quota.balance || quota.remaining)} tokens
              </span>
              <span className="divider">|</span>
              <span className="usage-section">
                <TrendingDown size={14} className="usage-icon" />
                30D: {formatTokens(quota.last30DaysUsage || 0)}
              </span>
              <button 
                className="action-button-compact refresh-account" 
                onClick={refetchAll}
                title="Refresh"
              >
                <RefreshCw size={14} />
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