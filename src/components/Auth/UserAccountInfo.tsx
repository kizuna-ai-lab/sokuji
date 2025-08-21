/**
 * Unified user account information component that combines user profile and quota status
 */

import {useEffect, useRef, useState} from 'react';
import {SignOutButton, useClerk, useUser} from '../../lib/clerk/ClerkProvider';
import {useUserProfile} from '../../contexts/UserProfileContext';
import {AlertCircle, LogOut, Settings} from 'lucide-react';
import {formatDate, formatPercentage, formatTokens, getQuotaWarningLevel} from '../../utils/formatters';
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
  const { isLoaded, isSignedIn, user: clerkUser } = useUser();
  const clerk = useClerk();
  
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

  // Get subscription from user data
  const subscription = user.subscription;

  if (compact) {
    return (
      <div className="user-account-compact">
        <div className="user-avatar">
          {clerkUser?.imageUrl ? (
            <img src={clerkUser.imageUrl} alt={user.firstName || 'User'} />
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


  // Quota data and calculations
  const warningLevel = quota ? getQuotaWarningLevel(quota.used, quota.total) : 'normal';
  const usagePercentage = quota ? formatPercentage(quota.used, quota.total) : 0;
  
  // Refs and state for UserProfile mounting
  const userProfileDivRef = useRef<HTMLDivElement>(null);
  const [isProfileMounted, setIsProfileMounted] = useState(false);

  // Handle manage account click - just show the overlay
  const handleManageAccount = () => {
    setIsProfileMounted(true);
  };

  // Mount UserProfile after the div is rendered
  useEffect(() => {
    if (isProfileMounted && userProfileDivRef.current && clerk) {
      clerk.mountUserProfile(userProfileDivRef.current);
    }
  }, [isProfileMounted, clerk]);

  // Handle close - unmount UserProfile and refresh data
  const handleCloseProfile = () => {
    if (userProfileDivRef.current && clerk) {
      clerk.unmountUserProfile(userProfileDivRef.current);
    }
    setIsProfileMounted(false);
    // Refresh both profile and quota data when closing
    refetchAll();
  };

  return (
    <div className="user-account">
      {/* User Profile Section */}
      <div className="user-header">
        <div className="user-avatar">
          {clerkUser?.imageUrl ? (
            <img src={clerkUser.imageUrl} alt={user.firstName || 'User'} />
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
      </div>

      {/* Action Buttons */}
      <div className="user-actions">
        <button 
          className="action-button manage-account"
          onClick={handleManageAccount}
        >
          <Settings size={16} />
          <span>Manage Account</span>
        </button>
        <SignOutButton>
          <button className="action-button sign-out">
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </SignOutButton>
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

      {/* UserProfile mounting point with overlay */}
      {isProfileMounted && (
        <div className="user-profile-overlay" onClick={handleCloseProfile}>
          <div 
            ref={userProfileDivRef} 
            className="user-profile-mount"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}