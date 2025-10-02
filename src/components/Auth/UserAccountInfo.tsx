/**
 * Unified user account information component that combines user profile and quota status
 */

import {useEffect} from 'react';
import {useAuth, useUser} from '../../lib/auth/hooks';
import {useUserProfile} from '../../contexts/UserProfileContext';
import {authClient} from '../../lib/auth-client';
import {AlertCircle, LogOut, RefreshCw, TrendingDown, UserCog, Wallet} from 'lucide-react';
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
  const { user: betterAuthUser } = useUser();

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
          <p className="user-email">{user.email}</p>
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
              await authClient.signOut();
              window.location.href = '/';
            }}
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>

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