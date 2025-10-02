/**
 * Better Auth hooks adapter layer
 *
 * This module provides hooks for authentication state management.
 */

import { useSession as useBetterAuthSession } from '../../lib/auth-client';

/**
 * Hook for authentication status
 * Provides API for checking authentication state
 */
export function useAuth() {
  const { data: session, isPending, error } = useBetterAuthSession();

  return {
    isLoaded: !isPending,
    isSignedIn: !!session,
    userId: session?.user?.id,
    sessionId: session?.session?.id,
    // Better Auth uses cookie-based sessions, so token is optional
    // If backend needs a token, it can be extracted from the session
    getToken: async (): Promise<string | null> => {
      console.log('useAuth.getToken()', session?.session);
      if (!session?.session) return null;
      // The session object itself can be used for authentication
      // Backend will validate via cookies
      return session.session.token;
    },
    error,
  };
}

/**
 * Hook for user information
 * Provides API for accessing user data
 */
export function useUser() {
  const { data: session, isPending } = useBetterAuthSession();

  return {
    isLoaded: !isPending,
    user: session?.user ? {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
      emailVerified: session.user.emailVerified,
      createdAt: session.user.createdAt,
      updatedAt: session.user.updatedAt,
    } : null,
  };
}

/**
 * Hook to get the full session object
 */
export function useSession() {
  return useBetterAuthSession();
}
