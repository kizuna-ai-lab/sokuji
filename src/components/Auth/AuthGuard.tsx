/**
 * Authentication guard component using Clerk's control components
 */

import React from 'react';
import { 
  SignedIn, 
  SignedOut, 
  RedirectToSignIn,
  ClerkLoading,
  ClerkLoaded,
  useUser
} from '../../lib/clerk/ClerkProvider';
import './AuthGuard.scss';

interface AuthGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  requirePremium?: boolean;
  loadingComponent?: React.ReactNode;
}

export function AuthGuard({ 
  children, 
  fallback,
  requirePremium = false,
  loadingComponent
}: AuthGuardProps) {
  return (
    <>
      <ClerkLoading>
        {loadingComponent || (
          <div className="auth-guard-loading">
            <div className="loading-spinner" />
            <p>Loading authentication...</p>
          </div>
        )}
      </ClerkLoading>
      
      <ClerkLoaded>
        <SignedIn>
          {requirePremium ? (
            <PremiumGuard fallback={fallback}>
              {children}
            </PremiumGuard>
          ) : (
            children
          )}
        </SignedIn>
        
        <SignedOut>
          {fallback || <RedirectToSignIn />}
        </SignedOut>
      </ClerkLoaded>
    </>
  );
}

// Premium subscription guard
function PremiumGuard({ 
  children, 
  fallback 
}: { 
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { user } = useUser();
  const subscription = user?.publicMetadata?.subscription || 'free';
  
  if (subscription === 'free') {
    return (
      <>
        {fallback || (
          <div className="premium-required">
            <h3>Premium Feature</h3>
            <p>This feature requires a premium subscription.</p>
            <button className="upgrade-button">
              Upgrade Now
            </button>
          </div>
        )}
      </>
    );
  }
  
  return <>{children}</>;
}

// Re-export Clerk's control components for convenience
export { SignedIn, SignedOut } from '../../lib/clerk/ClerkProvider';

// Custom hook to check authentication status
import { useAuth } from '../../lib/clerk/ClerkProvider';

export function useAuthStatus() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  
  return {
    isLoading: !isLoaded,
    isAuthenticated: isSignedIn,
    user,
    subscription: user?.publicMetadata?.subscription || 'free',
    isPremium: user?.publicMetadata?.subscription !== 'free'
  };
}