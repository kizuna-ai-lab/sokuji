/**
 * The app session's React side: the bridges the runner reads — sign-in,
 * analytics, the balance refetch — which only React can reach. The
 * run's state lives in `useRun.ts`, re-exported here. The only file under
 * `src/app` that imports `src/lib/analytics.ts`; with `useRun.ts` and
 * `AppSessionRoot.tsx`, the only ones that use React.
 */
import { useMemo } from 'react';
import { useAnalytics } from '../lib/analytics';
import { useAuth } from '../lib/auth/hooks';
import type { AuthContext } from '../lib/provider/types';
import type { AnalyticsPort } from '../lib/session/ports';
import { getAppSession } from './session';

export { useRunState, useRunPhase } from './useRun';

/** Hands the session the page's sign-in, analytics and balance refetch; returns the sign-in for the settings panel. `standIn` replaces the sign-in — the preview's `&signedin=1`, for a managed provider with no network. */
export function useAppSessionBridges(refetchQuota?: () => Promise<void>, standIn?: AuthContext): AuthContext {
  const { isLoaded, isSignedIn, userId, getToken, error } = useAuth();
  const { trackEvent } = useAnalytics();
  // A signed-out answer carrying an error is a session fetch that failed, not an answer (`useAuthContext.ts`): not loaded until the refetch answers.
  const loaded = isLoaded && !(!isSignedIn && error);
  const real = useMemo(() => ({ signedIn: isSignedIn, loaded, userId: userId ?? null, getToken }), [isSignedIn, loaded, userId, getToken]);
  const auth = standIn ?? real;
  // Every render, as the preview's bridge did: the runner reads them when it needs them, never a stale closure.
  getAppSession().setBridges({ auth, track: trackEvent as AnalyticsPort['track'], refetchQuota });
  return auth;
}
