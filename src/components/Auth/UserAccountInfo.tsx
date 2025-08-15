/**
 * Unified user account information component that combines user profile and quota status
 */

import React from 'react';
import { useUser, UserButton } from '../../lib/clerk/ClerkProvider';
import { useQuota } from '../../contexts/QuotaContext';
import { useUserProfile } from '../../contexts/UserProfileContext';
import { AlertCircle, TrendingUp } from 'lucide-react';
import './UserAccountInfo.scss';

interface UserAccountInfoProps {
  compact?: boolean;
  showWarning?: boolean;
  onManageSubscription?: () => void;
}

export function UserAccountInfo({ 
  compact = false, 
  showWarning = true,
  onManageSubscription 
}: UserAccountInfoProps) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { quotaInfo, warning, isLoading: quotaLoading, error: quotaError } = useQuota();
  
  // Get user profile from backend
  const { profile, isLoading: profileLoading } = useUserProfile();

  if (!isLoaded || profileLoading) {
    return (
      <div className="user-account-loading">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!isSignedIn || !user) {
    return null;
  }

  // Get subscription from backend profile data, fallback to 'free' if not available
  const subscription = profile?.user?.subscription || 'free';

  if (compact) {
    return (
      <div className="user-account-compact">
        <UserButton 
          appearance={{
            elements: {
              userButtonAvatarBox: {
                width: '32px',
                height: '32px'
              }
            }
          }}
        />
        <div className="user-info-compact">
          <span className="user-email">{user.primaryEmailAddress?.emailAddress}</span>
          <span className="user-subscription">{subscription}</span>
        </div>
      </div>
    );
  }

  const isUnlimited = quotaInfo?.total === -1;
  const usagePercentage = quotaInfo && quotaInfo.total > 0 
    ? (quotaInfo.used / quotaInfo.total) * 100 
    : 0;
  const remainingTokens = quotaInfo?.remaining || 0;

  return (
    <div className="user-account">
      {/* User Profile Section */}
      <div className="user-header">
        <UserButton 
          appearance={{
            elements: {
              userButtonAvatarBox: {
                width: '48px',
                height: '48px'
              }
            }
          }}
        />
        <div className="user-info">
          <h3 className="user-name">
            {user.firstName || user.lastName 
              ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
              : 'User'}
          </h3>
          <p className="user-email">{user.primaryEmailAddress?.emailAddress}</p>
        </div>
      </div>

      <div className="user-subscription-info">
        <div className="subscription-badge">
          <span className={`badge badge-${subscription}`}>
            {subscription.charAt(0).toUpperCase() + subscription.slice(1)} Plan
          </span>
        </div>

        {/* Quota Status Section */}
        {quotaLoading ? (
          <div className="quota-loading">
            <div className="loading-spinner" />
          </div>
        ) : quotaError ? (
          <div className="quota-error">
            <AlertCircle size={14} />
            <span>Unable to load quota</span>
          </div>
        ) : quotaInfo ? (
          <div className="quota-status-section">
            {showWarning && warning && (
              <div className={`quota-warning warning-${warning.level}`}>
                <AlertCircle size={14} />
                <span>{warning.message}</span>
              </div>
            )}

            <div className="quota-header">
              <h4>Token Usage</h4>
              {quotaInfo.resetDate && (
                <span className="reset-date">
                  Resets {new Date(quotaInfo.resetDate).toLocaleDateString()}
                </span>
              )}
            </div>

            <div className="quota-details">
              <div className="quota-bar-container">
                <div className="quota-bar">
                  <div 
                    className={`quota-progress ${usagePercentage > 80 ? 'high-usage' : ''}`}
                    style={{ width: isUnlimited ? '0%' : `${usagePercentage}%` }}
                  />
                </div>
                <div className="quota-labels">
                  <span className="usage-label">
                    {isUnlimited ? (
                      <>
                        <TrendingUp size={12} />
                        {(quotaInfo.used / 1000000).toFixed(2)}M used
                      </>
                    ) : (
                      <>
                        {(quotaInfo.used / 1000000).toFixed(2)}M / {(quotaInfo.total / 1000000).toFixed(0)}M
                      </>
                    )}
                  </span>
                  {!isUnlimited && (
                    <span className="remaining-label">
                      {(remainingTokens / 1000000).toFixed(2)}M remaining
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {subscription === 'free' && onManageSubscription && (
          <button 
            className="upgrade-button"
            onClick={onManageSubscription}
          >
            Upgrade to Premium
          </button>
        )}
      </div>
    </div>
  );
}