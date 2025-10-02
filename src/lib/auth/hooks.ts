/**
 * Better Auth hooks adapter layer
 *
 * This module provides hooks compatible with the previous Clerk API,
 * making migration easier by maintaining the same interface.
 */

import { useSession as useBetterAuthSession } from '../../lib/auth-client';

/**
 * Hook for authentication status
 * Provides Clerk-compatible API for checking authentication state
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
      if (!session?.session) return null;
      // The session object itself can be used for authentication
      // Backend will validate via cookies
      return session.session.id;
    },
    error,
  };
}

/**
 * Hook for user information
 * Provides Clerk-compatible API for accessing user data
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
