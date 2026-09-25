/**
 * The app session's React side: the run's state, and the bridges the runner
 * reads — sign-in, analytics, toasts, the balance refetch — which only React
 * can reach. The only file under `src/app` that imports React or
 * `src/lib/analytics.ts`.
 */
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useToast } from '../components/Toast';
import { useAnalytics } from '../lib/analytics';
import { useAuth } from '../lib/auth/hooks';
import type { AuthContext } from '../lib/provider/types';
import type { AnalyticsPort } from '../lib/session/ports';
import type { RunState } from '../lib/session/types';
import { getAppSession } from './session';

export function useRunState(): RunState {
  return useStore(getAppSession().runner.state);
}

export function useRunPhase(): RunState['phase'] {
  return useStore(getAppSession().runner.state, (s) => s.phase);
}

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
