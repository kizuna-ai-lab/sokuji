/**
 * The sign-in session as an `AuthContext` (spec: "What `credentials.read` may
 * consult besides the typed values"), for the pieces that check an own-key
 * provider's readiness. The same object `useAppSessionBridges` builds for the
 * runner (`src/app/useAppSession.ts`); mirrored here since these pieces have
 * no bridges to reuse. `loaded` says whether the sign-in has loaded (choice
 * 10); a stand-in provided through `AuthStandIn` wins.
 *
 * A signed-out answer that carries an error has not loaded: Better Auth
 * reports a session fetch that failed (offline, a backend stall) as loaded
 * and signed out, then refetches on `online` / focus — read as an answer,
 * an offline launch would tell a signed-in user to sign in. Not loaded, a
 * managed provider says "Checking..." until the refetch answers
 * (`useSignInProviderSwitch.ts` reads the same rule).
 */
import { createContext, useContext, useMemo } from 'react';
import { useAuth } from '../../lib/auth/hooks';
import type { AuthContext } from '../../lib/provider/types';

/** The development preview's stand-in sign-in (`&signedin=1`) for the Settings blocks it draws (choice 15); null in the app. */
export const AuthStandIn = createContext<AuthContext | null>(null);

export function useAuthContext(): AuthContext {
  const { isLoaded, isSignedIn, userId, getToken, error } = useAuth();
  const standIn = useContext(AuthStandIn);
  const loaded = isLoaded && !(!isSignedIn && error);
  const real = useMemo(() => ({ signedIn: isSignedIn, loaded, userId: userId ?? null, getToken }), [isSignedIn, loaded, userId, getToken]);
  return standIn ?? real;
}
