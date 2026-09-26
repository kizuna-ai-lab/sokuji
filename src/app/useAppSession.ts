/**
 * The app session's React side: the bridges the runner reads — sign-in,
 * analytics, toasts, the balance refetch — which only React can reach. The
 * run's state lives in `useRun.ts`, re-exported here. The only file under
 * `src/app` that imports `src/lib/analytics.ts`; with `useRun.ts` and
 * `AppSessionRoot.tsx`, the only ones that use React.
 */
import { useMemo } from 'react';
import { useToast } from '../components/Toast';
import { useAnalytics } from '../lib/analytics';
import { useAuth } from '../lib/auth/hooks';
import type { AuthContext } from '../lib/provider/types';
import type { AnalyticsPort } from '../lib/session/ports';
import { getAppSession } from './session';

export { useRunState, useRunPhase } from './useRun';

/** Hands the session the page's sign-in, analytics, toasts and balance refetch; returns the sign-in for the settings panel. */
export function useAppSessionBridges(refetchQuota?: () => Promise<void>): AuthContext {
  const { isSignedIn, getToken } = useAuth();
  const { trackEvent } = useAnalytics();
  const { showToast } = useToast();
  const auth = useMemo(() => ({ signedIn: isSignedIn, getToken }), [isSignedIn, getToken]);
  // Every render, as the preview's bridge did: the runner reads them when it needs them, never a stale closure.
  getAppSession().setBridges({ auth, track: trackEvent as AnalyticsPort['track'], notify: { showToast }, refetchQuota });
  return auth;
}
