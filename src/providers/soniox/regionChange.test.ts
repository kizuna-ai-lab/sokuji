import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

const reconcileSpy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('./voiceFieldReconcile', () => ({ reconcileSonioxVoiceField: reconcileSpy }));

import { registerAuth } from '../../app/currentAuth';
import { registerRunPhase } from '../../app/runPhase';
import { useProviderStore } from '../../stores/providerStore';
import { useRegionChangeStore } from '../../stores/regionChangeStore';
import { kizunaSonioxProvider } from './kizuna';
import { sonioxProvider } from './provider';
import { SONIOX_DEFAULTS, type SonioxSettings } from './settings';
import { requestSonioxRegionChange, sonioxRegionWarning } from './regionChange';

const S: SonioxSettings = { ...SONIOX_DEFAULTS, region: 'us' };
const settings = () => useProviderStore.getState().entries.kizunaai_soniox.settings as SonioxSettings;

beforeEach(async () => {
  reconcileSpy.mockClear();
  registerRunPhase(() => 'idle');
  useRegionChangeStore.setState({ question: null });
  useProviderStore.setState({ entries: {}, selected: null, selectionLocked: false, intent: undefined });
  await useProviderStore.getState().load(kizunaSonioxProvider);
  await useProviderStore.getState().load(sonioxProvider);
});

describe('sonioxRegionWarning', () => {
  it('warns only for a custom voice in the current region, naming what the new region will use', () => {
    expect(sonioxRegionWarning({ ...S, voice: 'Kenji' }, 'us', 'jp')).toBeNull();
    expect(sonioxRegionWarning({ ...S, voice: 'uuid-us', voiceJp: '' }, 'us', 'jp')).toEqual({ kind: 'built-in', name: 'Adrian' });
    expect(sonioxRegionWarning({ ...S, voice: 'uuid-us', voiceJp: 'Kenji' }, 'us', 'jp')).toEqual({ kind: 'built-in', name: 'Kenji' });
    expect(sonioxRegionWarning({ ...S, voice: 'uuid-us', voiceJp: 'uuid-jp' }, 'us', 'jp')).toEqual({ kind: 'custom' });
  });
});

describe('requestSonioxRegionChange', () => {
  it('a built-in voice switches at once, without asking', async () => {
    await expect(requestSonioxRegionChange(kizunaSonioxProvider, 'us', 'jp')).resolves.toBe(true);
    expect(settings().region).toBe('jp');
    expect(useRegionChangeStore.getState().question).toBeNull();
  });

  it('asks for a custom voice; cancel changes nothing; confirm changes only the region', async () => {
    await useProviderStore.getState().updateSettings(kizunaSonioxProvider, { voice: 'uuid-us' });
    const cancelled = requestSonioxRegionChange(kizunaSonioxProvider, 'us', 'jp');
    expect(useRegionChangeStore.getState().question).toMatchObject({ providerId: 'kizunaai_soniox', managed: true, from: 'us', to: 'jp' });
    useRegionChangeStore.getState().answer(false);
    await expect(cancelled).resolves.toBe(false);
    expect(settings()).toMatchObject({ region: 'us', voice: 'uuid-us' });

    const pending = requestSonioxRegionChange(kizunaSonioxProvider, 'us', 'jp');
    useRegionChangeStore.getState().answer(true);
    await expect(pending).resolves.toBe(true);
    expect(settings()).toMatchObject({ region: 'jp', voice: 'uuid-us', voiceJp: 'Adrian' });
  });

  it('own key asks with managed: false', async () => {
    await useProviderStore.getState().updateSettings(sonioxProvider, { voice: 'uuid-us' });
    const pending = requestSonioxRegionChange(sonioxProvider, 'us', 'eu');
    expect(useRegionChangeStore.getState().question).toMatchObject({ providerId: 'soniox', managed: false });
    useRegionChangeStore.getState().answer(true);
    await expect(pending).resolves.toBe(true);
  });

  it('refuses when from equals to', async () => {
    await expect(requestSonioxRegionChange(kizunaSonioxProvider, 'us', 'us')).resolves.toBe(false);
  });

  it('refuses during a session, and when a session started while the question was open', async () => {
    registerRunPhase(() => 'running');
    await expect(requestSonioxRegionChange(kizunaSonioxProvider, 'us', 'jp')).resolves.toBe(false);
    expect(useRegionChangeStore.getState().question).toBeNull();
    expect(settings().region).toBe('us');

    registerRunPhase(() => 'idle');
    await useProviderStore.getState().updateSettings(kizunaSonioxProvider, { voice: 'uuid-us' });
    const pending = requestSonioxRegionChange(kizunaSonioxProvider, 'us', 'jp');
    expect(useRegionChangeStore.getState().question).not.toBeNull();
    registerRunPhase(() => 'running');
    useRegionChangeStore.getState().answer(true);
    await expect(pending).resolves.toBe(false);
    expect(settings().region).toBe('us');
  });

  it('refuses when the region moved while the question was open', async () => {
    await useProviderStore.getState().updateSettings(kizunaSonioxProvider, { voice: 'uuid-us' });
    const pending = requestSonioxRegionChange(kizunaSonioxProvider, 'us', 'jp');
    await useProviderStore.getState().updateSettings(kizunaSonioxProvider, { region: 'eu' });
    useRegionChangeStore.getState().answer(true);
    await expect(pending).resolves.toBe(false);
    expect(settings().region).toBe('eu');
  });
});

describe('after a confirmed region change', () => {
  it('reconciles the new region’s field', async () => {
    await requestSonioxRegionChange(kizunaSonioxProvider, 'us', 'jp');
    expect(reconcileSpy).toHaveBeenCalledWith(kizunaSonioxProvider, 'jp', expect.any(Function));
  });
  it('and not for a refused change', async () => {
    await requestSonioxRegionChange(kizunaSonioxProvider, 'us', 'us');
    expect(reconcileSpy).not.toHaveBeenCalled();
  });

  it('hands the reconcile the live auth, not the caller’s snapshot', async () => {
    const snapshot = { signedIn: true, loaded: true, userId: 'old', getToken: async () => 't' };
    const live = { ...snapshot, userId: 'new' };
    registerAuth(() => live);
    try {
      await requestSonioxRegionChange(kizunaSonioxProvider, 'us', 'jp', snapshot);
      const reader = (reconcileSpy.mock.calls[0] as unknown as [unknown, unknown, () => { userId?: string | null } | undefined])[2];
      expect(reader()?.userId).toBe('new');
      live.userId = 'newer';
      expect(reader()?.userId).toBe('newer');
    } finally {
      registerAuth(() => undefined);
    }
  });
});
