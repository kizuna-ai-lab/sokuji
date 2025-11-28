/**
 * Better Auth client configuration
 *
 * This creates the auth client instance that connects to the Better Auth backend.
 * The client handles all authentication operations including sign in, sign up, and session management.
 */

import {createAuthClient} from "better-auth/react";
import {emailOTPClient, oneTimeTokenClient} from "better-auth/client/plugins";
import {getBackendUrl} from "../utils/environment";

export const authClient = createAuthClient({
  baseURL: getBackendUrl(),
  plugins: [
    emailOTPClient(),
    oneTimeTokenClient(),
  ],
});

// Export hooks for convenience
export const {
  useSession,
  signIn,
  signUp,
  signOut,
} = authClient;
