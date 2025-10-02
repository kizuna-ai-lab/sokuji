/**
 * Authentication guard component using Better Auth
 */

import React from 'react';
import {
  SignedIn,
  SignedOut,
  RedirectToSignIn,
  AuthLoading,
  AuthLoaded,
} from '../../lib/auth/guards';
import { useUser } from '../../lib/auth/hooks';
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
      <AuthLoading>
        {loadingComponent || (
          <div className="auth-guard-loading">
            <div className="loading-spinner" />
            <p>Loading authentication...</p>
          </div>
        )}
      </AuthLoading>

      <AuthLoaded>
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
      </AuthLoaded>
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

// Re-export control components for convenience
export { SignedIn, SignedOut } from '../../lib/auth/guards';

// Custom hook to check authentication status
import { useAuth } from '../../lib/auth/hooks';

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