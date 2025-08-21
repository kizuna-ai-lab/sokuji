/**
 * Unified user account information component that combines user profile and quota status
 */

import {useEffect, useRef, useState} from 'react';
import {SignOutButton, useClerk, useUser} from '../../lib/clerk/ClerkProvider';
import {useUserProfile} from '../../contexts/UserProfileContext';
import {AlertCircle, LogOut, UserCog} from 'lucide-react';
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
    <div className="user-account user-account-compact-layout">
      {/* Combined User Profile and Actions */}
      <div className="user-header-compact">
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
        <div className="user-actions-compact">
          <button 
            className="action-button-compact manage-account"
            onClick={handleManageAccount}
            title="Manage Account"
          >
            <UserCog size={14} />
          </button>
          <SignOutButton>
            <button 
              className="action-button-compact sign-out"
              title="Sign Out"
            >
              <LogOut size={14} />
            </button>
          </SignOutButton>
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
            <span>Unable to load quota information</span>
          </div>
        ) : (
          <>

            {/* Quota Display with Subscription Badge */}
            <div className="quota-header">
              <h4>Token Usage</h4>
              <span className={`badge badge-inline badge-${subscription}`}>
                {subscription.charAt(0).toUpperCase() + subscription.slice(1)}
              </span>
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

      {subscription === 'free' && onManageSubscription && (
        <div className="upgrade-section">
          <button 
            className="upgrade-button"
            onClick={onManageSubscription}
          >
            Upgrade to Premium
          </button>
        </div>
      )}

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