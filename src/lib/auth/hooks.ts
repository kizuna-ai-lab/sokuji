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
    // Better Auth session token for header-based authentication
    // Backend validates this token via Authorization header or WebSocket subprotocol
    getToken: async (): Promise<string | null> => {
      if (!session?.session) return null;
      // Return session token for use in Authorization headers or WebSocket connections
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
