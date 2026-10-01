/**
 * The one owner of the app session's page wiring (roadmap 1e-3a: one owner
 * each for `attach()` and the bridges): sign-in, analytics, toasts and the
 * balance refetch handed to the root, and `attach()` for the page's
 * lifetime. Mounted once, inside `UserProfileProvider`, by plan 1e-3b-2's
 * switch; the development preview is its own owner.
 */
import { useEffect } from 'react';
import { useUserProfile } from '../contexts/UserProfileContext';
import { getAppSession } from './session';
import { useAppSessionBridges } from './useAppSession';

export function AppSessionRoot(): null {
  const { refetchAll } = useUserProfile();
  // Today's MainPanel refetched the whole profile after a session (`refetchAll`).
  useAppSessionBridges(refetchAll);
  useEffect(() => getAppSession().attach(), []);
  return null;
}
