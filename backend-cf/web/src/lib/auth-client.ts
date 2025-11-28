/**
 * Better Auth client configuration for Sokuji Web Dashboard
 */

import { createAuthClient } from 'better-auth/react';
import { emailOTPClient, oneTimeTokenClient } from 'better-auth/client/plugins';

// Get backend URL from environment or use relative path for same-origin
const getBackendUrl = (): string => {
  // In development, Vite proxies /api to backend
  // In production, both are served from same domain
  return '';
};

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
