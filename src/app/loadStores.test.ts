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
import { stageProviderId, useLineUpStore } from '../stores/lineUpStore';
import { registerPresentProviders } from '../lib/plan/present';
import type { AnyProvider } from '../lib/provider/types';
import { presentProviders } from '../providers/registry';
import useLogStore from '../stores/logStore';
import { useProviderStore } from '../stores/providerStore';
import { runsOn } from '../stores/lineUpStore.testing';
import { useRoutingStore } from '../stores/routingStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useTurnModeStore } from '../stores/turnModeStore';
import { planFromStores } from '../lib/plan/fromStores';
import { liveGate, readShapeFromStores } from '../lib/session/appShape';
import { loadLineUpProviders, loadSessionStores } from './loadStores';

/** The keys written, besides the line-up — the one migration a load makes (owner, 2026-11-15). */
/** The provider that transcribes, as the line-up store stands: what a launch left running. */
const running = () => stageProviderId('transcription');

const writesBesidesLineUp = () => setSetting.mock.calls.map(([key]) => key).filter((key) => key !== 'settings.lineup');

const providersBefore = useProviderStore.getState();
const routingBefore = useRoutingStore.getState();
const segmentationBefore = useSegmentationStore.getState();
const turnModeBefore = useTurnModeStore.getState();

beforeEach(() => {
  stored.clear();
  setSetting.mockClear();
  // Each test starts with no line-up in memory, as a launch does. One write, and first: a watch an earlier launch
  // left behind then sees nothing to load.
  useLineUpStore.setState({ lineUp: null, stored: false, unstoredProvider: null, locked: false });
  useProviderStore.setState({ entries: {}, intent: undefined, readiness: {} });
});

afterEach(() => {
  useProviderStore.setState(providersBefore, true);
  useRoutingStore.setState(routingBefore, true);
  useSegmentationStore.setState(segmentationBefore, true);
  useTurnModeStore.setState(turnModeBefore, true);
  vi.restoreAllMocks();
});

describe('loadSessionStores', () => {
  it('loads the turn mode, the routing switches, the punctuation pack, and runs the first offered provider — writing nothing but the line-up', async () => {
    stored.set('settings.common.turnMode', 'push-to-talk');
    stored.set('settings.routing.meeting', false);
    const refresh = vi.fn(async () => {});
    useSegmentationStore.setState({ refresh });

    await loadSessionStores();

    expect(useTurnModeStore.getState().turnMode).toBe('push-to-talk');
    expect(useTurnModeStore.getState().pushKey).toBe('Space');
    expect(useRoutingStore.getState().meeting).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The registry's first offered provider (Stage 2 Kizuna Soniox, ruling 6), loaded, and what runs.
    expect(useProviderStore.getState().entries.kizunaai_soniox).toBeDefined();
    expect(running()).toBe('kizunaai_soniox');
    expect(writesBesidesLineUp()).toEqual([]);
  });

  it('loads the stored push key, and Space in place of one a hold cannot take', async () => {
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });
    stored.set('settings.common.turnMode', 'push-to-talk');
    stored.set('settings.common.pushKey', 'ControlRight');
    await loadSessionStores();
    expect(useTurnModeStore.getState().pushKey).toBe('ControlRight');

    stored.set('settings.common.pushKey', 'Escape');
    await loadSessionStores();
    expect(useTurnModeStore.getState().pushKey).toBe('Space');
    expect(writesBesidesLineUp()).toEqual([]);
  });

  it('runs the stored provider, loads its entry, and never writes it back', async () => {
    stored.set('settings.common.provider', 'local_inference');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(running()).toBe('local_inference');
    expect(useProviderStore.getState().entries.local_inference).toBeDefined();
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
  });

  it('falls back to the first offered provider when the stored one is not offered here, and never overwrites the stored value', async () => {
    // OpenAI Compatible, retired (Stage 2 OpenAI Realtime, ruling 1): no build registers it.
    stored.set('settings.common.provider', 'openai_compatible');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    // The registry's first offered provider (Stage 2 Kizuna Soniox, ruling 6).
    expect(running()).toBe('kizunaai_soniox');
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
    expect(stored.get('settings.common.provider')).toBe('openai_compatible');
  });

  it("loads the entry of the provider the page already runs instead of the first offered", async () => {
    runsOn('fake');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(running()).toBe('fake');
    expect(useProviderStore.getState().entries.fake).toBeDefined();
    // The registry's first offered provider (Stage 2 Kizuna Soniox, ruling 6).
    expect(useProviderStore.getState().entries.kizunaai_soniox).toBeUndefined();
    expect(setSetting).not.toHaveBeenCalledWith('settings.lineup', expect.anything());
  });

  it("runs Kizuna Soniox for a stored 'kizunaai', and never writes it back", async () => {
    stored.set('settings.common.provider', 'kizunaai');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(running()).toBe('kizunaai_soniox');
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
  });

  it("runs Kizuna Soniox for a stored 'kizunaai_volcengine_ast2', and never writes it back", async () => {
    stored.set('settings.common.provider', 'kizunaai_volcengine_ast2');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(running()).toBe('kizunaai_soniox');
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
  });

  it('runs the stored fake provider in a development build', async () => {
    stored.set('settings.common.provider', 'fake');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(running()).toBe('fake');
    expect(useProviderStore.getState().entries.fake).toBeDefined();
  });

  it('migrates the turn mode from the stored provider once, when nothing is stored under the global key', async () => {
    stored.set('settings.common.provider', 'openai');
    stored.set('settings.openai.turnDetectionMode', 'Push-to-Talk');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(useTurnModeStore.getState().turnMode).toBe('push-to-talk');
    expect(setSetting).toHaveBeenCalledWith('settings.common.turnMode', 'push-to-talk');
    expect(writesBesidesLineUp()).toEqual(['settings.common.turnMode']);
  });

  it('never migrates once the global turn mode is already stored', async () => {
    stored.set('settings.common.turnMode', 'push-to-translate');
    stored.set('settings.openai.turnDetectionMode', 'Push-to-Talk');
    stored.set('settings.common.provider', 'openai');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(useTurnModeStore.getState().turnMode).toBe('push-to-translate');
    expect(writesBesidesLineUp()).toEqual([]);
  });

  it('migrates to auto when the stored provider has no legacy slice', async () => {
    stored.set('settings.common.provider', 'fake');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(useTurnModeStore.getState().turnMode).toBe('auto');
    expect(setSetting).toHaveBeenCalledWith('settings.common.turnMode', 'auto');
    expect(writesBesidesLineUp()).toEqual(['settings.common.turnMode']);
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

// The stored line-up decides what runs: a launch reads it, runs it, and writes nothing.
describe('a launch with a stored line-up', () => {
  const lineUpOf = (transcription: string, translation: string, speech: string | null) => ({ version: 2, stages: { transcription, translation, speech, summarisation: null } });

  it('runs the stored line-up, whatever provider is stored beside it, and writes nothing', async () => {
    stored.set('settings.common.provider', 'local_inference');
    stored.set('settings.lineup', lineUpOf('soniox', 'soniox', 'edge'));
    stored.set('settings.common.turnMode', 'auto');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    const found = planFromStores();
    if (found.state !== 'ready') throw new Error(`expected a ready plan, got ${found.state}`);
    expect(found.plan.units.map((u) => [u.provider.id, u.stages])).toEqual([['soniox', ['transcription', 'translation']], ['local_inference', ['speech']]]);
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, unstoredProvider: null });
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('keeps a stored line-up the composer refuses: the plan is refused, Start says why, and storage is untouched', async () => {
    const refused = lineUpOf('soniox', 'soniox', null);
    stored.set('settings.common.provider', 'soniox');
    stored.set('settings.lineup', refused);
    stored.set('settings.common.turnMode', 'auto');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    expect(planFromStores()).toEqual({ state: 'refused', refusal: { refused: 'lineup_incomplete', stage: 'speech' } });
    expect(liveGate()).toMatchObject({ code: 'lineup_incomplete', params: { stage: 'speech' } });
    expect(readShapeFromStores({ signedIn: false, getToken: async () => null })).toBeNull();
    // The line-up page shows the stored choices, to be changed.
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: refused.stages });
    expect(setSetting).not.toHaveBeenCalled();
    expect(stored.get('settings.lineup')).toBe(refused);
  });

  it('with none stored and a development provider the catalog does not hold, runs that provider and stores no line-up', async () => {
    stored.set('settings.common.provider', 'fake');
    stored.set('settings.common.turnMode', 'auto');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });

    await loadSessionStores();

    const found = planFromStores();
    expect(found.state === 'ready' && found.plan.units.map((u) => u.provider.id)).toEqual(['fake']);
    expect(useLineUpStore.getState()).toMatchObject({ stored: false, unstoredProvider: 'fake' });
    expect(setSetting).not.toHaveBeenCalled();
  });
});

// The provider that runs while no line-up is stored is resolved by the line-up store, over the providers offered.
describe('the provider a launch runs, by the order the providers are offered in', () => {
  const offer = (providers: readonly AnyProvider[]) => registerPresentProviders(() => providers);
  afterEach(() => registerPresentProviders(presentProviders));

  it("is the default managed provider for a stored 'kizunaai' even where it is not offered first, and is never written back", async () => {
    stored.set('settings.common.provider', 'kizunaai');
    // Not the registry's order: here the first offered is not the managed default, so landing on the first offered would not pass.
    offer([localInferenceProvider, sonioxProvider, kizunaSonioxProvider]);
    await useLineUpStore.getState().load();
    await loadLineUpProviders([localInferenceProvider, sonioxProvider, kizunaSonioxProvider]);

    expect(useLineUpStore.getState().lineUp).toMatchObject({ transcription: 'kizunaai_soniox' });
    expect(useProviderStore.getState().entries.kizunaai_soniox).toBeDefined();
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
  });

  it('is a stored own-key provider that is offered, though a managed default is offered too', async () => {
    stored.set('settings.common.provider', 'soniox');
    offer([kizunaSonioxProvider, localInferenceProvider, sonioxProvider]);
    await useLineUpStore.getState().load();
    await loadLineUpProviders([kizunaSonioxProvider, localInferenceProvider, sonioxProvider]);

    expect(useLineUpStore.getState().lineUp).toMatchObject({ transcription: 'soniox' });
    expect(useProviderStore.getState().entries.soniox).toBeDefined();
  });
});

// Every provider the line-up names has its entry loaded, and so has the provider that runs while none is stored.
describe("the entries of the line-up's providers", () => {
  const offered = [kizunaSonioxProvider, sonioxProvider, localInferenceProvider];
  const lineUp = (transcription: string, translation: string, speech: string) => ({ transcription, translation, speech, summarisation: null });

  it("loads every provider the line-up names: the local provider when its voice reads another provider's text", async () => {
    await useProviderStore.getState().load(sonioxProvider);
    for (const speech of ['edge', 'local_inference']) {
      useProviderStore.setState({ entries: { soniox: useProviderStore.getState().entries.soniox } });
      useLineUpStore.setState({ lineUp: lineUp('soniox', 'soniox', speech), stored: true });
      await loadLineUpProviders(offered);
      expect(Object.keys(useProviderStore.getState().entries).sort()).toEqual(['local_inference', 'soniox']);
      expect(useProviderStore.getState().entries.local_inference.settings).toMatchObject({ voices: {}, ttsSpeed: 1 });
    }
  });

  it('leaves a loaded entry as it is, and loads nothing the line-up does not name', async () => {
    await useProviderStore.getState().load(localInferenceProvider);
    const entry = useProviderStore.getState().entries.local_inference;
    const load = vi.spyOn(useProviderStore.getState(), 'load');
    useLineUpStore.setState({ lineUp: lineUp('local_inference', 'bing', 'edge'), stored: true });
    await loadLineUpProviders(offered);
    expect(load).not.toHaveBeenCalled();
    expect(useProviderStore.getState().entries).toEqual({ local_inference: entry });
  });

  it('loads the provider that runs while no line-up is stored, though the line-up shown does not name it', async () => {
    useLineUpStore.setState({ lineUp: lineUp('local_inference', 'bing', 'edge'), stored: false, unstoredProvider: 'soniox' });
    await loadLineUpProviders(offered);
    expect(Object.keys(useProviderStore.getState().entries).sort()).toEqual(['local_inference', 'soniox']);
  });

  it('loads nothing with no line-up, or for a provider this build does not offer', async () => {
    await loadLineUpProviders(offered);
    useLineUpStore.setState({ lineUp: lineUp('openai', 'openai', 'openai'), stored: true });
    await loadLineUpProviders(offered);
    expect(useProviderStore.getState().entries).toEqual({});
  });

  it('two calls that overlap load a provider once', async () => {
    const load = vi.spyOn(useProviderStore.getState(), 'load');
    useLineUpStore.setState({ lineUp: lineUp('soniox', 'soniox', 'local_inference'), stored: true });
    // The second starts before the first has loaded anything: both see the entries missing.
    await Promise.all([loadLineUpProviders(offered), loadLineUpProviders(offered)]);
    expect(load.mock.calls.map(([p]) => p.id).sort()).toEqual(['local_inference', 'soniox']);
    expect(Object.keys(useProviderStore.getState().entries).sort()).toEqual(['local_inference', 'soniox']);
    // Once settled, a load is not held on to: an entry dropped since is loaded again.
    useProviderStore.setState({ entries: { soniox: useProviderStore.getState().entries.soniox } });
    await loadLineUpProviders(offered);
    expect(load.mock.calls.map(([p]) => p.id).sort()).toEqual(['local_inference', 'local_inference', 'soniox']);
  });

  it('a launch loads them, and so does every later change of the line-up', async () => {
    stored.set('settings.common.provider', 'soniox');
    useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });
    await loadSessionStores();
    // The line-up worked out at launch names the stored provider alone, and nothing else was loaded.
    expect(Object.keys(useProviderStore.getState().entries)).toEqual(['soniox']);

    useLineUpStore.setState({ lineUp: lineUp('soniox', 'soniox', 'edge'), stored: true });
    await vi.waitFor(() => expect(useProviderStore.getState().entries.local_inference).toBeDefined());
    expect(Object.keys(useProviderStore.getState().entries).sort()).toEqual(['local_inference', 'soniox']);
  });

  describe('while the first loads are still awaited', () => {
    /** The stores and the loader of a page that has never launched: no watch of an earlier launch is listening. */
    async function freshPage() {
      vi.resetModules();
      const [{ loadSessionStores: launch }, lineUpStore, providerStore, segmentationStore] = await Promise.all([
        import('./loadStores'), import('../stores/lineUpStore'), import('../stores/providerStore'), import('../stores/segmentationStore'),
      ]);
      return { launch, lineUps: lineUpStore.useLineUpStore, providers: providerStore.useProviderStore, segmentation: segmentationStore.useSegmentationStore };
    }
    afterEach(() => { vi.resetModules(); });

    it('a change of the line-up loads the new host', async () => {
      stored.set('settings.common.provider', 'soniox');
      const page = await freshPage();
      // The punctuation pack is still loading: the launch has not finished.
      let finish!: () => void;
      page.segmentation.setState({ refresh: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })) });
      const launching = page.launch();
      await vi.waitFor(() => expect(page.providers.getState().entries.soniox).toBeDefined());
      expect(page.providers.getState().entries.local_inference).toBeUndefined();

      // Chosen on the settings page meanwhile: Edge reads Soniox's text.
      page.lineUps.setState({ lineUp: lineUp('soniox', 'soniox', 'edge'), stored: true });
      await vi.waitFor(() => expect(page.providers.getState().entries.local_inference).toBeDefined());

      finish();
      await launching;
      expect(Object.keys(page.providers.getState().entries).sort()).toEqual(['local_inference', 'soniox']);
    });

    it('the host the launch itself names is loaded once, by the watch and the launch between them', async () => {
      stored.set('settings.common.provider', 'soniox');
      const page = await freshPage();
      page.segmentation.setState({ refresh: vi.fn(async () => {}) });
      const load = vi.spyOn(page.providers.getState(), 'load');
      await page.launch();
      expect(load.mock.calls.map(([p]) => p.id)).toEqual(['soniox']);
    });

    it('a launch whose line-up load fails still loads the providers the store names, and reports the failure once', async () => {
      const page = await freshPage();
      const [{ default: logs }, { settleReports: settle }] = await Promise.all([import('../stores/logStore'), import('../lib/diagnostics/report')]);
      logs.getState().setEnabled(true);
      logs.getState().clearLogs();
      page.segmentation.setState({ refresh: vi.fn(async () => {}) });
      // The store already names what runs, and this load changes nothing before it fails: no change of the
      // line-up follows for the watch to hear.
      page.lineUps.setState({ lineUp: lineUp('soniox', 'soniox', 'edge'), stored: true });
      vi.spyOn(page.lineUps.getState(), 'load').mockRejectedValue(new Error('disk'));
      await page.launch();
      expect(Object.keys(page.providers.getState().entries).sort()).toEqual(['local_inference', 'soniox']);
      await settle();
      const warnings = logs.getState().allLogs.filter((l) => l.message.includes('line-up'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ type: 'warning' });
      expect(warnings[0].message).toContain('Loading the line-up failed: disk');
    });
  });
});
