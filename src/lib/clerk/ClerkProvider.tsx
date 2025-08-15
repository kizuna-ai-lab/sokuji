/**
 * Platform-aware Clerk provider
 * 
 * Build configuration determines which Clerk SDK is used:
 * - Electron builds: Vite aliases @clerk/chrome-extension to @clerk/clerk-react
 * - Extension builds: Uses @clerk/chrome-extension directly
 * 
 * This ensures proper tree-shaking and only one package is included in the bundle.
 */

import { isElectron, isExtension } from '../../utils/environment';

// Re-export environment detection for backward compatibility
export const isExtensionEnvironment = isExtension();
export const isElectronEnvironment = isElectron();

// Always import from @clerk/chrome-extension
// For Electron builds, Vite will alias this to @clerk/clerk-react
// For Extension builds, it uses the actual @clerk/chrome-extension
export {
  ClerkProvider,
  SignIn,
  SignUp,
  UserButton,
  UserProfile,
  SignedIn,
  SignedOut,
  SignOutButton,
  RedirectToSignIn,
  ClerkLoading,
  ClerkLoaded,
  useAuth,
  useUser,
  useClerk,
  useSignIn,
  useSignUp,
  useSession,
  useOrganization,
  useOrganizationList,
} from '@clerk/chrome-extension';