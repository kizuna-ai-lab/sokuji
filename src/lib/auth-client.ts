/**
 * Better Auth client configuration
 *
 * This creates the auth client instance that connects to the Better Auth backend.
 * The client handles all authentication operations including sign in, sign up, and session management.
 */

import { createAuthClient } from "better-auth/react";

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:8787";

export const authClient = createAuthClient({
  baseURL: backendUrl,
});

// Export hooks for convenience
export const {
  useSession,
  signIn,
  signUp,
  signOut,
} = authClient;
