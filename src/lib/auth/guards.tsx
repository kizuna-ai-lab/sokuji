/**
 * Authentication guard components
 *
 * These components provide guards for conditional rendering
 * based on authentication state.
 */

import React, { useEffect, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './hooks';

interface GuardProps {
  children: ReactNode;
}

/**
 * Renders children only when user is signed in
 */
export function SignedIn({ children }: GuardProps) {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) {
    return null;
  }

  return isSignedIn ? <>{children}</> : null;
}

/**
 * Renders children only when user is signed out
 */
export function SignedOut({ children }: GuardProps) {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) {
    return null;
  }

  return !isSignedIn ? <>{children}</> : null;
}

/**
 * Redirects to sign-in page if user is not authenticated
 */
export function RedirectToSignIn() {
  const { isSignedIn, isLoaded } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      navigate('/sign-in', { replace: true });
    }
  }, [isLoaded, isSignedIn, navigate]);

  return null;
}

/**
 * Loading state component
 */
export function AuthLoading({ children }: GuardProps) {
  const { isLoaded } = useAuth();

  return !isLoaded ? <>{children}</> : null;
}

/**
 * Loaded state component
 */
export function AuthLoaded({ children }: GuardProps) {
  const { isLoaded } = useAuth();

  return isLoaded ? <>{children}</> : null;
}
