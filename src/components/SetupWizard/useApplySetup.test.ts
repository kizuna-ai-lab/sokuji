/**
 * `useApplySetup`'s `applyProvider`, bound to the real `providerStore` (final
 * review Minor 4): nothing covered this binding — `SetupWizard.test.tsx`
 * mocks the whole hook, and the group checks' probe seeds `settings.setup`,
 * so a fresh wizard run never exercises Finish. `applySetupDraft` itself
 * (its own ordering, presets and skip rules) is `applySetup.test.ts`'s; this
 * is only the store-write half `applySetupDraft` hands off as `applyProvider`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { stored, getSetting, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    getSetting: vi.fn(async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def)),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    }),
  };
});
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting, setSetting }) },
}));

import { Provider } from '../../types/Provider';
import { useProviderStore } from '../../stores/providerStore';
import { useApplySetup } from './useApplySetup';
import { initialDraft } from './setupDraft';
import type { SetupDraft } from './setupDraft';

const draft = (over: Partial<SetupDraft>): SetupDraft => ({
  ...initialDraft(), step: 5, scenario: 'be-heard', providerPath: 'offline', provider: Provider.LOCAL_INFERENCE,
  credentials: {}, credentialsValidated: true, sourceLanguage: 'en', targetLanguage: 'ja', ...over,
});

beforeEach(() => {
  stored.clear();
  // A stored pair different from the draft's, so setPair's own persist call
  // (only fields that actually change) is guaranteed to fire either way.
  stored.set('settings.localInference.sourceLanguage', 'ja');
  stored.set('settings.localInference.targetLanguage', 'en');
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, selected: null, selectionLocked: false });
});

describe("useApplySetup's applyProvider (review Minor 4)", () => {
  it('Finish on LocalInference loads it, sets the pair, selects it as a pick, and persists the pair + settings.common.provider', async () => {
    const { result } = renderHook(() => useApplySetup());

    await result.current(draft({}));

    expect(useProviderStore.getState().selected).toBe('localInference');
    expect(useProviderStore.getState().entries.localInference?.pair).toEqual({ source: 'en', target: 'ja' });
    expect(setSetting).toHaveBeenCalledWith('settings.common.provider', 'local_inference');
    expect(setSetting).toHaveBeenCalledWith('settings.localInference.sourceLanguage', 'en');
    expect(setSetting).toHaveBeenCalledWith('settings.localInference.targetLanguage', 'ja');
  });

  it("drops credentials the provider does not take (LocalInference's own credentials.keys is empty)", async () => {
    const { result } = renderHook(() => useApplySetup());

    await result.current(draft({ providerPath: 'own-key', credentials: { apiKey: 'sk-1' } }));

    expect(useProviderStore.getState().entries.localInference?.credentials).toEqual({});
    expect(setSetting).not.toHaveBeenCalledWith('settings.localInference.apiKey', expect.anything());
  });

  it('throws before any write when the draft names a provider this build does not offer', async () => {
    const { result } = renderHook(() => useApplySetup());

    await expect(result.current(draft({ provider: Provider.OPENAI }))).rejects.toThrow(/This build does not offer/);

    expect(useProviderStore.getState().selected).toBeNull();
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
  });
});
