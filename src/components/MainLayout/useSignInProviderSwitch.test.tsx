import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { stored, setSetting, trackEvent } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    setSetting: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    }),
    trackEvent: vi.fn(),
  };
});
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def),
      setSetting,
    }),
  },
}));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));

const reportWarning = vi.hoisted(() => vi.fn());
vi.mock('../../lib/diagnostics/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/diagnostics/report')>();
  return { ...actual, reportWarning };
});

let auth: { isLoaded: boolean; isSignedIn: boolean; error?: unknown } = { isLoaded: true, isSignedIn: false };
vi.mock('../../lib/auth/hooks', () => ({ useAuth: () => auth }));

import { presentProviders } from '../../providers/registry';
import { localInferenceProvider } from '../../providers/localInference/provider';
import { readShapeFromStores } from '../../lib/session/appShape';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { signInSwitchTarget, useSignInProviderSwitch } from './useSignInProviderSwitch';

function renderSwitch(wizard = false) {
  return renderHook(({ wizard }) => useSignInProviderSwitch(wizard), { initialProps: { wizard } });
}

beforeEach(() => {
  stored.clear();
  setSetting.mockClear();
  trackEvent.mockClear();
  reportWarning.mockClear();
  auth = { isLoaded: true, isSignedIn: false };
  useProviderStore.setState({ selected: 'localInference', selectionLocked: false, entries: {} });
  useSettingsStore.setState({ uiMode: 'basic' });
});

describe('useSignInProviderSwitch', () => {
  it('moves a Basic-mode user who signs in onto Kizuna Soniox, as a pick, and tracks it', () => {
    const { rerender } = renderSwitch(false);
    auth = { isLoaded: true, isSignedIn: true };
    rerender({ wizard: false });

    expect(useProviderStore.getState().selected).toBe('kizunaai_soniox');
    expect(setSetting).toHaveBeenCalledWith('settings.common.provider', 'kizunaai_soniox');
    expect(trackEvent).toHaveBeenCalledWith('settings_modified', {
      setting_name: 'provider',
      new_value: 'kizunaai_soniox',
      old_value: 'local_inference',
      category: 'api',
    });
  });

  it('leaves an Advanced-mode user where they are', () => {
    useSettingsStore.setState({ uiMode: 'advanced' });
    const { rerender } = renderSwitch(false);
    auth = { isLoaded: true, isSignedIn: true };
    rerender({ wizard: false });

    expect(useProviderStore.getState().selected).toBe('localInference');
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('never switches under the wizard, and the flip is spent', () => {
    const { rerender } = renderSwitch(true);
    auth = { isLoaded: true, isSignedIn: true };
    rerender({ wizard: true });
    expect(useProviderStore.getState().selected).toBe('localInference');

    // The wizard closes afterward: the flip that happened underneath it is
    // spent, not merely deferred.
    rerender({ wizard: false });
    expect(useProviderStore.getState().selected).toBe('localInference');
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('leaves a managed provider as it is', () => {
    useProviderStore.setState({ selected: 'fake_leased' });
    const { rerender } = renderSwitch(false);
    auth = { isLoaded: true, isSignedIn: true };
    rerender({ wizard: false });

    expect(useProviderStore.getState().selected).toBe('fake_leased');
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('a session restored at launch is not a sign-in', () => {
    auth = { isLoaded: false, isSignedIn: false };
    const { rerender } = renderSwitch(false);
    auth = { isLoaded: true, isSignedIn: true };
    rerender({ wizard: false });

    expect(useProviderStore.getState().selected).toBe('localInference');
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('an offline or failed-fetch launch is not a sign-in either, even once it resolves', () => {
    // Better Auth answers a failed session fetch as loaded, signed out (its
    // own session-refresh manager quietly retries on `online`/focus); a
    // signed-out answer that carries an error has not really told us the
    // restored session is signed out, so it must not arm the "next sign-in
    // switches" flip the way a genuine 200-with-null-body answer does.
    auth = { isLoaded: true, isSignedIn: false, error: new Error('offline') };
    const { rerender } = renderSwitch(false);
    auth = { isLoaded: true, isSignedIn: true };
    rerender({ wizard: false });

    expect(useProviderStore.getState().selected).toBe('localInference');
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('a plain signed-out answer, with no error, still arms a real sign-in', () => {
    auth = { isLoaded: true, isSignedIn: false };
    const { rerender } = renderSwitch(false);
    auth = { isLoaded: true, isSignedIn: true };
    rerender({ wizard: false });

    expect(useProviderStore.getState().selected).toBe('kizunaai_soniox');
    expect(trackEvent).toHaveBeenCalledTimes(1);
  });

  it('refused during a run: nothing changes, nothing is tracked', () => {
    useProviderStore.setState({ selectionLocked: true });
    // A bare `entries.kizunaai_soniox` check can't fail here: `load` only
    // settles after several microtasks (its own `Promise.all` over the
    // mocked async `getSetting`), so entries would still read empty at this
    // point even if `load` had been called. Spying on `load` itself is the
    // check that can actually catch a call that should never happen.
    const realLoad = useProviderStore.getState().load;
    const loadSpy = vi.fn();
    useProviderStore.setState({ load: loadSpy });
    const { rerender } = renderSwitch(false);
    auth = { isLoaded: true, isSignedIn: true };
    rerender({ wizard: false });

    expect(useProviderStore.getState().selected).toBe('localInference');
    expect(trackEvent).not.toHaveBeenCalled();
    expect(loadSpy).not.toHaveBeenCalled();
    useProviderStore.setState({ load: realLoad });
  });

  it('refused during a run: no warning is reported for a change the user never asked for', () => {
    useProviderStore.setState({ selectionLocked: true });
    const { rerender } = renderSwitch(false);
    auth = { isLoaded: true, isSignedIn: true };
    rerender({ wizard: false });

    // The hook checks the lock itself before ever calling `select`, so the
    // store's own "cannot change during a session" warning — meant for a
    // person's own blocked pick — never fires for a switch nobody asked for.
    expect(reportWarning).not.toHaveBeenCalled();
  });

  it("loads the managed provider's entry, so Start follows at once with Settings closed", async () => {
    const { rerender } = renderSwitch(false);
    auth = { isLoaded: true, isSignedIn: true };
    rerender({ wizard: false });

    // select() alone only sets `selected` (providerStore.ts): an entry is
    // otherwise loaded by useSelectedProvider's effect, which a closed
    // Settings (a hidden <Activity>) does not run. The hook is rendered here
    // exactly as it would be with Settings closed — nothing else loads it.
    await waitFor(() => expect(useProviderStore.getState().entries.kizunaai_soniox).toBeDefined());
    expect(readShapeFromStores({ signedIn: true, userId: 'u1', getToken: async () => 't' })?.provider.id).toBe('kizunaai_soniox');
  });
});

describe('signInSwitchTarget', () => {
  it('names the first managed provider unless one is selected', () => {
    const offered = presentProviders();
    expect(signInSwitchTarget(offered, 'localInference')?.id).toBe('kizunaai_soniox');
    expect(signInSwitchTarget(offered, 'kizunaai_soniox')).toBeNull();
    expect(signInSwitchTarget([localInferenceProvider], 'localInference')).toBeNull();
  });
});
