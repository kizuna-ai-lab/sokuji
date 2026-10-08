import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same reason as ProviderPanel.test.tsx: a `stored` map and a `setSetting`
// spy stand in for the settings service every store loads through.
const { stored, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    setSetting: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    }),
  };
});
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def),
      setSetting,
    }),
  },
}));

import { settleReports } from '../lib/diagnostics/report';
import { localInferenceProvider } from '../providers/localInference/provider';
import { kizunaSonioxProvider } from '../providers/soniox/kizuna';
import { sonioxProvider } from '../providers/soniox/provider';
import { ServiceFactory } from '../services/ServiceFactory';
import useLogStore from '../stores/logStore';
import { useProviderStore } from '../stores/providerStore';
import { useRoutingStore } from '../stores/routingStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useTurnModeStore } from '../stores/turnModeStore';
import { loadSelectedProvider, loadSessionStores } from './loadStores';

const providersBefore = useProviderStore.getState();
const routingBefore = useRoutingStore.getState();
const segmentationBefore = useSegmentationStore.getState();
const turnModeBefore = useTurnModeStore.getState();

beforeEach(() => {
  stored.clear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, intent: undefined, readiness: {}, selected: null });
});

afterEach(() => {
  useProviderStore.setState(providersBefore, true);
  useRoutingStore.setState(routingBefore, true);
  useSegmentationStore.setState(segmentationBefore, true);
  useTurnModeStore.setState(turnModeBefore, true);
  vi.restoreAllMocks();
});

describe('loadSessionStores', () => {
  it('loads the turn mode, the routing switches, the punctuation pack, and selects the first offered provider in memory — writing nothing', async () => {
    stored.set('settings.common.turnMode', 'push-to-talk');
    stored.set('settings.routing.meeting', false);
    const refresh = vi.fn(async () => {});
    useSegmentationStore.setState({ refresh });

    await loadSessionStores();

    expect(useTurnModeStore.getState().turnMode).toBe('push-to-talk');
    expect(useRoutingStore.getState().meeting).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The registry's first offered provider (Stage 2 Kizuna Soniox, ruling 6), loaded and selected.
    expect(useProviderStore.getState().entries.kizunaai_soniox).toBeDefined();
    expect(useProviderStore.getState().selected).toBe('kizunaai_soniox');
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('selects the stored provider in memory, loads its entry, and never writes it back', async () => {
    stored.set('settings.common.provider', 'local_inference');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(useProviderStore.getState().selected).toBe('local_inference');
    expect(useProviderStore.getState().entries.local_inference).toBeDefined();
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
  });

  it('falls back to the first offered provider when the stored one is not offered here, and never overwrites the stored value', async () => {
    // OpenAI Compatible, retired (Stage 2 OpenAI Realtime, ruling 1): no build registers it.
    stored.set('settings.common.provider', 'openai_compatible');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    // The registry's first offered provider (Stage 2 Kizuna Soniox, ruling 6).
    expect(useProviderStore.getState().selected).toBe('kizunaai_soniox');
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
  });

  it("loads the selected provider's entry instead of the first offered, when the page already selected one", async () => {
    useProviderStore.setState({ selected: 'fake' });
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(useProviderStore.getState().selected).toBe('fake');
    expect(useProviderStore.getState().entries.fake).toBeDefined();
    // The registry's first offered provider (Stage 2 Kizuna Soniox, ruling 6).
    expect(useProviderStore.getState().entries.kizunaai_soniox).toBeUndefined();
  });

  it("selects Kizuna Soniox for a stored 'kizunaai', and never writes it back", async () => {
    stored.set('settings.common.provider', 'kizunaai');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(useProviderStore.getState().selected).toBe('kizunaai_soniox');
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
  });

  it("selects Kizuna Soniox for a stored 'kizunaai_volcengine_ast2', and never writes it back", async () => {
    stored.set('settings.common.provider', 'kizunaai_volcengine_ast2');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(useProviderStore.getState().selected).toBe('kizunaai_soniox');
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
  });

  it('selects the stored fake provider in a development build', async () => {
    stored.set('settings.common.provider', 'fake');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(useProviderStore.getState().selected).toBe('fake');
    expect(useProviderStore.getState().entries.fake).toBeDefined();
  });

  it('migrates the turn mode from the stored provider once, when nothing is stored under the global key', async () => {
    stored.set('settings.common.provider', 'openai');
    stored.set('settings.openai.turnDetectionMode', 'Push-to-Talk');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(useTurnModeStore.getState().turnMode).toBe('push-to-talk');
    expect(setSetting).toHaveBeenCalledWith('settings.common.turnMode', 'push-to-talk');
    expect(setSetting).toHaveBeenCalledTimes(1);
  });

  it('never migrates once the global turn mode is already stored', async () => {
    stored.set('settings.common.turnMode', 'push-to-translate');
    stored.set('settings.openai.turnDetectionMode', 'Push-to-Talk');
    stored.set('settings.common.provider', 'openai');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(useTurnModeStore.getState().turnMode).toBe('push-to-translate');
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('migrates to auto when the stored provider has no legacy slice', async () => {
    stored.set('settings.common.provider', 'fake');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(useTurnModeStore.getState().turnMode).toBe('auto');
    expect(setSetting).toHaveBeenCalledWith('settings.common.turnMode', 'auto');
    expect(setSetting).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected turn-mode load once as a warning, and still loads the rest', async () => {
    useLogStore.getState().setEnabled(true);
    useLogStore.getState().clearLogs();
    const refresh = vi.fn(async () => {});
    useSegmentationStore.setState({ refresh });
    const getSetting = vi.fn(async (key: string, def: unknown) => {
      if (key === 'settings.common.turnMode') throw new Error('disk');
      return stored.has(key) ? stored.get(key) : def;
    });
    vi.spyOn(ServiceFactory, 'getSettingsService').mockReturnValue({ getSetting, setSetting } as unknown as ReturnType<typeof ServiceFactory.getSettingsService>);

    await loadSessionStores();
    await settleReports();

    const warnings = useLogStore.getState().allLogs.filter((l) => l.message.includes('turn mode'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('warning');
    expect(useRoutingStore.getState().meeting).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The registry's first offered provider (Stage 2 Kizuna Soniox, ruling 6).
    expect(useProviderStore.getState().entries.kizunaai_soniox).toBeDefined();
  });
});

describe('loadSelectedProvider', () => {
  it("selects the default managed provider for a stored 'kizunaai' even where it is not offered first, and never writes it back", async () => {
    stored.set('settings.common.provider', 'kizunaai');
    // Not the registry's order: here the first offered is not the managed default, so landing on the first offered would not pass.
    await loadSelectedProvider(ServiceFactory.getSettingsService(), [localInferenceProvider, sonioxProvider, kizunaSonioxProvider]);

    expect(useProviderStore.getState().selected).toBe('kizunaai_soniox');
    expect(useProviderStore.getState().entries.kizunaai_soniox).toBeDefined();
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
  });

  it('keeps a stored own-key provider that is offered, though a managed default is offered too', async () => {
    stored.set('settings.common.provider', 'soniox');
    await loadSelectedProvider(ServiceFactory.getSettingsService(), [kizunaSonioxProvider, localInferenceProvider, sonioxProvider]);

    expect(useProviderStore.getState().selected).toBe('soniox');
    expect(useProviderStore.getState().entries.soniox).toBeDefined();
  });
});
