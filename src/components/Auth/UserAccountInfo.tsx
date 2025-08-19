/**
 * Unified user account information component that combines user profile and quota status
 */

import React from 'react';
import { useUser, UserButton } from '../../lib/clerk/ClerkProvider';
import { useUserProfile } from '../../contexts/UserProfileContext';
import { AlertCircle } from 'lucide-react';
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