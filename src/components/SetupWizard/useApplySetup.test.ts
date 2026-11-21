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
import { stageProviderId, useLineUpStore } from '../../stores/lineUpStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRoutingStore } from '../../stores/routingStore';
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
  useLineUpStore.setState({ lineUp: null, stored: false, unstoredProvider: null, locked: false });
  useProviderStore.setState({ entries: {}, intent: undefined });
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
  it('Finish on LocalInference loads it, sets the pair, stores its line-up so that it runs, and persists the pair + settings.common.provider', async () => {
    const { result } = renderHook(() => useApplySetup());

    await result.current(draft({}));

    // What runs is the stored line-up: the wizard selects nothing apart from it.
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, unstoredProvider: null, lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge' } });
    expect(stageProviderId('transcription')).toBe('local_inference');
    expect(useProviderStore.getState().entries.local_inference?.pair).toEqual({ source: 'en', target: 'ja' });
    expect(setSetting).toHaveBeenCalledWith('settings.common.provider', 'local_inference');
    expect(setSetting).toHaveBeenCalledWith('settings.common.sourceLanguage', 'en');
    expect(setSetting).toHaveBeenCalledWith('settings.common.targetLanguage', 'ja');
  });

  it('writes the pair, then the line-up, then the provider beside it, then the record', async () => {
    const { result } = renderHook(() => useApplySetup());

    await result.current(draft({}));

    const keys = setSetting.mock.calls.map(([key]) => key);
    const at = (key: string) => keys.indexOf(key);
    expect(at('settings.common.targetLanguage')).toBeGreaterThanOrEqual(0);
    expect(at('settings.common.targetLanguage')).toBeLessThan(at('settings.lineup'));
    expect(at('settings.lineup')).toBeLessThan(at('settings.common.provider'));
    expect(at('settings.common.provider')).toBeLessThan(at('settings.setup'));
    expect(keys.filter((key) => key === 'settings.common.provider')).toHaveLength(1);
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

  it("binds setParticipantSpeech to the routing store: a Both voice scenario turns Translation I hear on", async () => {
    const before = useRoutingStore.getState().participantSpeech;
    try {
      useRoutingStore.getState().setParticipantSpeech(false);
      const { result } = renderHook(() => useApplySetup());
      await result.current(draft({ scenario: 'two-way-voice' }));
      expect(useRoutingStore.getState().participantSpeech).toBe(true);
    } finally {
      useRoutingStore.getState().setParticipantSpeech(before);
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

    expect(useLineUpStore.getState()).toMatchObject({ stored: false, lineUp: null, unstoredProvider: null });
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
    expect(setSetting).not.toHaveBeenCalledWith('settings.lineup', expect.anything());
  });

  it('records setup complete only after every provider write has landed', async () => {
    const held: Array<() => void> = [];
    setSetting.mockImplementation((key: string, value: unknown) => {
      // The record, and the line-up stored after the provider's writes (Plan 6) with the provider's id beside it,
      // land at once: the provider's own writes are held.
      if (key === 'settings.setup' || key === 'settings.lineup' || key === 'settings.common.provider') return landNow(key, value);
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

// Plan 6, Task 4: Finish stores the line-up through the line-up store, before the record.
describe("useApplySetup's applyLineUp", () => {
  it('stores the line-up of the chosen path before the record', async () => {
    const { result } = renderHook(() => useApplySetup());
    await result.current(draft({}));
    expect(stored.get('settings.lineup')).toEqual({ version: 2, stages: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null } });
    const keys = setSetting.mock.calls.map(([key]) => key);
    expect(keys.indexOf('settings.lineup')).toBeLessThan(keys.indexOf('settings.setup'));
  });

  it('fails Finish with the setup-persist error, recording nothing, when the line-up does not land', async () => {
    setSetting.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'settings.lineup') return { success: false, error: 'QuotaExceededError' };
      return landNow(key, value);
    });
    const { result } = renderHook(() => useApplySetup());
    await expect(result.current(draft({}))).rejects.toBeInstanceOf(SetupPersistError);
    expect(setSetting).not.toHaveBeenCalledWith('settings.setup', expect.anything());
  });

  // Review Focus 5: the key typed for an OpenAI provider is the one OpenAI key every OpenAI provider reads.
  it('Finish on OpenAI Realtime stores the typed key as the one OpenAI key', async () => {
    const { result } = renderHook(() => useApplySetup());
    await result.current(draft({ providerPath: 'own-key', provider: Provider.OPENAI, credentials: { apiKey: 'sk-live' } }));
    expect(stored.get('settings.openai.apiKey')).toBe('sk-live');
    expect(stored.get('settings.lineup')).toMatchObject({ stages: { transcription: 'openai', translation: 'openai', speech: 'openai' } });
  });
});
