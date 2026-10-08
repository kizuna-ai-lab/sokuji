/**
 * A sign-in moves a Basic-mode user onto the managed provider (Stage 2
 * Kizuna Soniox, ruling 4; the old `MainLayout.tsx:160-199`, removed in
 * `8044e074`): Basic mode only; never under the setup wizard, whose Finish
 * writes the provider (backing out must leave it as it was); from a
 * provider that is not managed already; as a person's pick, through the
 * store's lock (refused during a run), its entry loaded (Settings may be
 * closed); tracked as `settings_modified`. One
 * refinement (choice 14): a session restored at launch is not a sign-in —
 * the flip counts only once the sign-in has loaded signed out.
 */
import { useEffect, useRef } from 'react';
import { useAnalytics } from '../../lib/analytics';
import { useAuth } from '../../lib/auth/hooks';
import type { AnyProvider } from '../../lib/provider/types';
import { presentProviders } from '../../providers/registry';
import { useProviderStore } from '../../stores/providerStore';
import { useUIMode } from '../../stores/settingsStore';

/** The provider a sign-in switches to: the first managed one offered, unless the selected one is managed already. */
export function signInSwitchTarget(offered: readonly AnyProvider[], selected: string | null): AnyProvider | null {
  if (offered.find((p) => p.id === selected)?.kind === 'managed') return null;
  return offered.find((p) => p.kind === 'managed') ?? null;
}

export function useSignInProviderSwitch(wizardOnScreen: boolean): void {
  const { isLoaded, isSignedIn, error } = useAuth();
  const uiMode = useUIMode();
  const { trackEvent } = useAnalytics();
  /** The sign-in as last seen once loaded; null before it has loaded. */
  const seen = useRef<boolean | null>(null);
  useEffect(() => {
    // `isLoaded` absent (a stub) reads as loaded. A signed-out answer that
    // carries an error has not really answered: Better Auth reports
    // `{ isLoaded: true, isSignedIn: false }` for a launch whose session
    // fetch failed (offline, a backend stall), then quietly refetches on
    // `online`/focus — treating that as "loaded, signed out" would let the
    // later, successful refetch read as a fresh sign-in and switch a
    // restored session (choice 14).
    if (isLoaded === false || (!isSignedIn && error)) return;
    const before = seen.current;
    seen.current = isSignedIn;
    if (before !== false || !isSignedIn || wizardOnScreen || uiMode !== 'basic') return;
    const from = useProviderStore.getState().selected;
    const target = signInSwitchTarget(presentProviders(), from);
    if (!target) return;
    // A run's lock refuses the pick and logs a warning of its own (meant for
    // a person's own blocked pick): skip it rather than trigger one for a
    // change the user never asked for.
    if (useProviderStore.getState().selectionLocked) return;
    useProviderStore.getState().select(target.id, 'pick');
    // Guards the same lock taking hold between the check above and now.
    if (useProviderStore.getState().selected !== target.id) return;
    // `select()` loads nothing, and a closed Settings runs no loader: load
    // the entry here, as `useApplySetup` does, so Start follows at once.
    if (!useProviderStore.getState().entries[target.id]) void useProviderStore.getState().load(target);
    trackEvent('settings_modified', {
      setting_name: 'provider',
      new_value: target.id,
      old_value: from ?? undefined,
      category: 'api',
    });
  }, [isLoaded, isSignedIn, error, uiMode, wizardOnScreen, trackEvent]);
}
