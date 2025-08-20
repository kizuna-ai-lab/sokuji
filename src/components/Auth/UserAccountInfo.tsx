/**
 * Unified user account information component that combines user profile and quota status
 */

import React from 'react';
import { useUser, UserButton } from '../../lib/clerk/ClerkProvider';
import { useUserProfile } from '../../contexts/UserProfileContext';
import { AlertCircle } from 'lucide-react';
import { formatTokens, formatPercentage, formatDate, getQuotaWarningLevel } from '../../utils/formatters';
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
  
  // Get user profile from backend
  const { profile, isLoading: profileLoading } = useUserProfile();

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


  // Quota data and calculations
  const quota = profile?.quota;
  const warningLevel = quota ? getQuotaWarningLevel(quota.used, quota.total) : 'normal';
  const usagePercentage = quota ? formatPercentage(quota.used, quota.total) : 0;

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

      {/* Quota Status Section */}
      <div className="quota-status-section">
        {profileLoading ? (
          <div className="quota-loading">
            <div className="loading-spinner" />
          </div>
        ) : !quota ? (
          <div className="quota-error">
            <AlertCircle size={14} />
            <span>Unable to load quota information</span>
          </div>
        ) : (
          <>
            {/* Quota Warning */}
            {showWarning && warningLevel !== 'normal' && (
              <div className={`quota-warning warning-${warningLevel === 'critical' ? 'exceeded' : 'low'}`}>
                <AlertCircle size={14} />
                <span>
                  {warningLevel === 'critical' 
                    ? `You've used ${usagePercentage}% of your monthly quota`
                    : `Approaching quota limit: ${usagePercentage}% used`
                  }
                </span>
              </div>
            )}

            {/* Quota Display */}
            <div className="quota-header">
              <h4>Token Usage</h4>
              {quota.resetDate && (
                <span className="reset-date">Resets {formatDate(quota.resetDate)}</span>
              )}
            </div>

            <div className="quota-details">
              <div className="quota-bar-container">
                <div className="quota-bar">
                  <div 
                    className={`quota-progress ${usagePercentage >= 80 ? 'high-usage' : ''}`}
                    style={{ width: `${Math.min(usagePercentage, 100)}%` }}
                  />
                </div>
              </div>

              <div className="quota-labels">
                <div className="usage-label">
                  <span>{formatTokens(quota.used)} used</span>
                </div>
                <div className="remaining-label">
                  {formatTokens(quota.remaining)} remaining
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="user-subscription-info">
        <div className="subscription-badge">
          <span className={`badge badge-${subscription}`}>
            {subscription.charAt(0).toUpperCase() + subscription.slice(1)} Plan
          </span>
        </div>

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