/**
 * The sign-in session as an `AuthContext` (spec: "What `credentials.read` may
 * consult besides the typed values"), for the pieces that check an own-key
 * provider's readiness. The same object `useAppSessionBridges` builds for the
 * runner (`src/app/useAppSession.ts`); mirrored here since these pieces have
 * no bridges to reuse.
 */
import { useMemo } from 'react';
import { useAuth } from '../../lib/auth/hooks';
import type { AuthContext } from '../../lib/provider/types';

export function useAuthContext(): AuthContext {
  const { isSignedIn, userId, getToken } = useAuth();
  return useMemo(() => ({ signedIn: isSignedIn, userId: userId ?? null, getToken }), [isSignedIn, userId, getToken]);
}
