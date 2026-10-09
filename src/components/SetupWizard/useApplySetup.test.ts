/**
 * `useApplySetup`'s `applyProvider`, bound to the real `providerStore` (final
 * review Minor 4): nothing covered this binding — `SetupWizard.test.tsx`
 * mocks the whole hook, and the group checks' probe seeds `settings.setup`,
 * so a fresh wizard run never exercises Finish. `applySetupDraft` itself
 * (its own ordering, presets and skip rules) is `applySetup.test.ts`'s; this
 * is only the store-write half `applySetupDraft` hands off as `applyProvider`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

import { Provider, type ProviderType } from '../../types/Provider';
import { readCredentials } from '../../lib/provider/credentials';
import { volcengineAst2Provider } from '../../providers/volcengine_ast2/provider';
import { localInferenceProvider } from '../../providers/localInference/provider';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { SetupPersistError } from '../../stores/setupStore';
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
  stored.set('settings.common.sourceLanguage', 'ja');
  stored.set('settings.common.targetLanguage', 'en');
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, selected: null, selectionLocked: false, intent: undefined });
});

const landNow = async (key: string, value: unknown) => {
  stored.set(key, value);
  return { success: true };
};
// The provider store keeps what did not land across tests: put storage back and drain it.
afterEach(async () => {
  setSetting.mockImplementation(landNow);
  await useProviderStore.getState().flush();
});

describe("useApplySetup's applyProvider (review Minor 4)", () => {
  it('Finish on LocalInference loads it, sets the pair, selects it as a pick, and persists the pair + settings.common.provider', async () => {
    const { result } = renderHook(() => useApplySetup());

    await result.current(draft({}));

    expect(useProviderStore.getState().selected).toBe('local_inference');
    expect(useProviderStore.getState().entries.local_inference?.pair).toEqual({ source: 'en', target: 'ja' });
    expect(setSetting).toHaveBeenCalledWith('settings.common.provider', 'local_inference');
    expect(setSetting).toHaveBeenCalledWith('settings.common.sourceLanguage', 'en');
    expect(setSetting).toHaveBeenCalledWith('settings.common.targetLanguage', 'ja');
  });

  it('leaves both display modes as the user chose them: a re-run of a two-way scenario writes neither (Stage 2 session end, ruling 1)', async () => {
    useSettingsStore.setState({ speakerDisplayMode: 'source', participantDisplayMode: 'source' });
    try {
      const { result } = renderHook(() => useApplySetup());

      await result.current(draft({ scenario: 'two-way-voice' }));

      expect(useSettingsStore.getState().speakerDisplayMode).toBe('source');
      expect(useSettingsStore.getState().participantDisplayMode).toBe('source');
      expect(setSetting).not.toHaveBeenCalledWith('settings.common.speakerDisplayMode', expect.anything());
      expect(setSetting).not.toHaveBeenCalledWith('settings.common.participantDisplayMode', expect.anything());
    } finally {
      useSettingsStore.setState({ speakerDisplayMode: 'both', participantDisplayMode: 'both' });
    }
  });

  it("drops credentials the provider does not take (LocalInference's own credentials.keys is empty)", async () => {
    const { result } = renderHook(() => useApplySetup());

    await result.current(draft({ providerPath: 'own-key', credentials: { apiKey: 'sk-1' } }));

    expect(useProviderStore.getState().entries.local_inference?.credentials).toEqual({});
    expect(setSetting).not.toHaveBeenCalledWith('settings.localInference.apiKey', expect.anything());
  });

  it('Finish on Doubao AST 2.0 with only an API key writes the chosen mode, so the key is the credential read (Stage 2 Volcengine AST2, I2)', async () => {
    const { result } = renderHook(() => useApplySetup());

    await result.current(draft({
      providerPath: 'own-key', provider: Provider.VOLCENGINE_AST2,
      credentials: { apiKey: 'key-1' }, credentialChoice: { setting: 'authMode', value: 'apiKey' },
    }));

    const entry = useProviderStore.getState().entries.volcengine_ast2!;
    expect((entry.settings as { authMode: string }).authMode).toBe('apiKey');
    expect(readCredentials(volcengineAst2Provider, entry.settings, entry.credentials, { signedIn: false, getToken: async () => null }))
      .toEqual({ kind: 'apiKey', apiKey: 'key-1' });
    expect(setSetting).toHaveBeenCalledWith('settings.volcengineAST2.authMode', 'apiKey');
    expect(setSetting).toHaveBeenCalledWith('settings.volcengineAST2.apiKey', 'key-1');
  });

  it('Finish writes the credential choice before the credentials, which are the fields it shows', async () => {
    const { updateSettings, setCredential } = useProviderStore.getState();
    const spies = { updateSettings: vi.fn(updateSettings), setCredential: vi.fn(setCredential) };
    useProviderStore.setState(spies);
    try {
      const { result } = renderHook(() => useApplySetup());

      await result.current(draft({
        providerPath: 'own-key', provider: Provider.VOLCENGINE_AST2,
        credentials: { apiKey: 'key-1' }, credentialChoice: { setting: 'authMode', value: 'apiKey' },
      }));

      const choiceAt = spies.updateSettings.mock.calls.findIndex(([p, patch]) => p.id === 'volcengine_ast2' && 'authMode' in patch);
      expect(choiceAt).toBeGreaterThanOrEqual(0);
      expect(spies.setCredential).toHaveBeenCalledWith(expect.objectContaining({ id: 'volcengine_ast2' }), 'apiKey', 'key-1');
      expect(spies.updateSettings.mock.invocationCallOrder[choiceAt]).toBeLessThan(Math.min(...spies.setCredential.mock.invocationCallOrder));
    } finally {
      useProviderStore.setState({ updateSettings, setCredential });
    }
  });

  it('writes no setting a provider has no credential choice over', async () => {
    const { result } = renderHook(() => useApplySetup());

    await result.current(draft({ providerPath: 'own-key', credentialChoice: { setting: 'authMode', value: 'apiKey' } }));

    expect(setSetting).not.toHaveBeenCalledWith('settings.localInference.authMode', expect.anything());
  });

  it('throws before any write when the draft names a provider this build does not offer', async () => {
    const { result } = renderHook(() => useApplySetup());

    // OpenAI Compatible, retired (Stage 2 OpenAI Realtime, ruling 1): no build offers it, and its id is
    // only stored data now (Stage 2 deletion, ruling C1).
    await expect(result.current(draft({ provider: 'openai_compatible' as ProviderType }))).rejects.toThrow(/This build does not offer/);

    expect(useProviderStore.getState().selected).toBeNull();
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
  });

  it('records setup complete only after every provider write has landed', async () => {
    const held: Array<() => void> = [];
    setSetting.mockImplementation((key: string, value: unknown) => {
      if (key === 'settings.setup') return landNow(key, value);
      return new Promise<{ success: boolean }>((resolve) => { held.push(() => { stored.set(key, value); resolve({ success: true }); }); });
    });
    const { result } = renderHook(() => useApplySetup());

    const finishing = result.current(draft({}));
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    const recordedEarly = setSetting.mock.calls.some(([key]) => key === 'settings.setup');
    // Released before any assertion: a held write would hold the drain in afterEach.
    for (const release of held.splice(0)) release();
    await finishing;

    expect(recordedEarly).toBe(false);
    expect(setSetting).toHaveBeenCalledWith('settings.setup', expect.objectContaining({ provider: Provider.LOCAL_INFERENCE }));
    expect(stored.get('settings.common.provider')).toBe('local_inference');
  });

  it('fails Finish with the setup-persist error, recording nothing, when a provider write does not land', async () => {
    setSetting.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'settings.common.sourceLanguage') return { success: false, error: 'QuotaExceededError' };
      return landNow(key, value);
    });
    const { result } = renderHook(() => useApplySetup());

    await expect(result.current(draft({}))).rejects.toBeInstanceOf(SetupPersistError);

    expect(setSetting).not.toHaveBeenCalledWith('settings.setup', expect.anything());
  });

  it('Finish again writes what did not land — a pair already in memory too — and then records', async () => {
    setSetting.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'settings.common.sourceLanguage') return { success: false, error: 'QuotaExceededError' };
      return landNow(key, value);
    });
    const { result } = renderHook(() => useApplySetup());
    await expect(result.current(draft({}))).rejects.toBeInstanceOf(SetupPersistError);

    setSetting.mockImplementation(landNow);
    await result.current(draft({}));

    expect(stored.get('settings.common.sourceLanguage')).toBe('en');
    expect(stored.get('settings.setup')).toEqual(expect.objectContaining({ provider: Provider.LOCAL_INFERENCE }));
  });

  it("a value of the provider's own that storage refuses, written before Finish, does not fail it", async () => {
    // A prompt over the extension's per-item quota, edited in Settings before the wizard re-runs.
    setSetting.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'settings.localInference.systemPrompt') return { success: false, error: 'QuotaExceededError' };
      return landNow(key, value);
    });
    await useProviderStore.getState().load(localInferenceProvider);
    useProviderStore.getState().updateSettings(localInferenceProvider, { systemPrompt: 'a long agenda' });
    const { result } = renderHook(() => useApplySetup());

    await result.current(draft({}));

    expect(stored.get('settings.setup')).toEqual(expect.objectContaining({ provider: Provider.LOCAL_INFERENCE }));
    expect(stored.get('settings.common.sourceLanguage')).toBe('en');
  });
});
