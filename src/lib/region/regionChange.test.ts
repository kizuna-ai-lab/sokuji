import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

import { registerRunPhase } from '../../app/runPhase';
import { kizunaQwenProvider } from '../../providers/qwen_livetranslate/kizuna';
import { kizunaSonioxProvider } from '../../providers/soniox/kizuna';
import { sonioxProvider } from '../../providers/soniox/provider';
import { useProviderStore } from '../../stores/providerStore';
import { useRegionChangeStore } from '../../stores/regionChangeStore';
import { useRegionRecommendationStore } from '../../stores/regionRecommendationStore';
const reportWarning = vi.hoisted(() => vi.fn());
vi.mock('../diagnostics/report', () => ({ reportWarning }));

import { requestRegionChange } from './regionChange';

const region = (id: string) => (useProviderStore.getState().entries[id].settings as { region: string }).region;
const realUpdateSettings = useProviderStore.getState().updateSettings;

beforeEach(async () => {
  registerRunPhase(() => 'idle');
  useRegionChangeStore.setState({ question: null });
  useRegionRecommendationStore.setState({ records: {} });
  useProviderStore.setState({ entries: {}, selected: null, selectionLocked: false, intent: undefined });
  await useProviderStore.getState().load(kizunaSonioxProvider);
  await useProviderStore.getState().load(sonioxProvider);
  await useProviderStore.getState().load(kizunaQwenProvider);
});
// The rejecting `updateSettings` spy of the throw test must not leak into later tests: the store holds it too.
afterEach(() => {
  vi.restoreAllMocks();
  useProviderStore.setState({ updateSettings: realUpdateSettings });
});

describe('requestRegionChange', () => {
  it('a select change records chose-manually; a list change does not; own key records nothing', async () => {
    await expect(requestRegionChange({ providerId: 'kizunaai_soniox', to: 'jp', origin: 'list' })).resolves.toBe(true);
    expect(region('kizunaai_soniox')).toBe('jp');
    expect(useRegionRecommendationStore.getState().records.kizunaai_soniox).toBeUndefined();

    await expect(requestRegionChange({ providerId: 'kizunaai_soniox', to: 'eu', origin: 'select' })).resolves.toBe(true);
    expect(useRegionRecommendationStore.getState().records.kizunaai_soniox?.status).toBe('chose-manually');

    await expect(requestRegionChange({ providerId: 'soniox', to: 'eu', origin: 'select' })).resolves.toBe(true);
    expect(region('soniox')).toBe('eu');
    expect(useRegionRecommendationStore.getState().records).not.toHaveProperty('soniox');
  });

  it('records nothing when the change did not happen', async () => {
    await expect(requestRegionChange({ providerId: 'kizunaai_soniox', to: 'us', origin: 'select' })).resolves.toBe(false);
    expect(useRegionRecommendationStore.getState().records.kizunaai_soniox).toBeUndefined();
  });

  it('Qwen changes without a warning and records chose-manually from the select', async () => {
    await expect(requestRegionChange({ providerId: 'kizunaai_qwen', to: 'cn', origin: 'select' })).resolves.toBe(true);
    expect(region('kizunaai_qwen')).toBe('cn');
    expect(useRegionChangeStore.getState().question).toBeNull();
    expect(useRegionRecommendationStore.getState().records.kizunaai_qwen?.status).toBe('chose-manually');
  });

  it('refuses an unknown provider, an unloaded one, and a run in progress', async () => {
    await expect(requestRegionChange({ providerId: 'openai', to: 'eu', origin: 'select' })).resolves.toBe(false);
    useProviderStore.setState({ entries: {} });
    await expect(requestRegionChange({ providerId: 'kizunaai_qwen', to: 'cn', origin: 'select' })).resolves.toBe(false);
    await useProviderStore.getState().load(kizunaQwenProvider);
    registerRunPhase(() => 'running');
    await expect(requestRegionChange({ providerId: 'kizunaai_qwen', to: 'cn', origin: 'select' })).resolves.toBe(false);
    expect(region('kizunaai_qwen')).not.toBe('cn');
  });

  it('a throw inside the path is reported once and the change resolves false', async () => {
    reportWarning.mockClear();
    const boom = new Error('boom');
    const spy = vi.spyOn(useProviderStore.getState(), 'updateSettings').mockRejectedValue(boom);
    useProviderStore.setState({ updateSettings: spy } as never);
    await expect(requestRegionChange({ providerId: 'kizunaai_qwen', to: 'cn', origin: 'select' })).resolves.toBe(false);
    expect(reportWarning).toHaveBeenCalledTimes(1);
    expect(reportWarning).toHaveBeenCalledWith('RegionChange', expect.any(String), expect.objectContaining({ dedupeKey: 'region:change', cause: boom }));
  });

  describe('following a pending hint through the drop-down', () => {
    const hint = { status: 'hint' as const, medians: { sg: 200, cn: 40 }, recommended: 'cn', at: 1, attempts: 1 };

    it('a select change while the hint is pending reports one switched event, then records chose-manually', async () => {
      useRegionRecommendationStore.setState({ records: { kizunaai_qwen: hint } });
      const track = vi.fn();
      await expect(requestRegionChange({ providerId: 'kizunaai_qwen', to: 'cn', origin: 'select', track })).resolves.toBe(true);
      expect(track).toHaveBeenCalledTimes(1);
      expect(track).toHaveBeenCalledWith({
        provider: 'kizunaai_qwen', medians: { sg: 200, cn: 40 }, current: 'sg', recommended: 'cn', outcome: 'switched', chosen: 'cn',
      });
      expect(useRegionRecommendationStore.getState().records.kizunaai_qwen?.status).toBe('chose-manually');
    });

    it('chosen is the region picked, even when it is not the recommended one (Soniox)', async () => {
      useRegionRecommendationStore.setState({ records: { kizunaai_soniox: { ...hint, medians: { us: 177, eu: 237, jp: 13, in: 136 }, recommended: 'jp' } } });
      const track = vi.fn();
      await expect(requestRegionChange({ providerId: 'kizunaai_soniox', to: 'in', origin: 'select', track })).resolves.toBe(true);
      expect(track).toHaveBeenCalledTimes(1);
      expect(track.mock.calls[0][0]).toMatchObject({ provider: 'kizunaai_soniox', current: 'us', recommended: 'jp', outcome: 'switched', chosen: 'in' });
      expect(useRegionRecommendationStore.getState().records.kizunaai_soniox?.status).toBe('chose-manually');
    });

    it('no event without a pending hint, for a list change (the list reports itself), or when nothing changed', async () => {
      const track = vi.fn();
      await requestRegionChange({ providerId: 'kizunaai_qwen', to: 'cn', origin: 'select', track });
      useRegionRecommendationStore.setState({ records: { kizunaai_qwen: { ...hint, status: 'acted' } } });
      await requestRegionChange({ providerId: 'kizunaai_qwen', to: 'sg', origin: 'select', track });
      useRegionRecommendationStore.setState({ records: { kizunaai_qwen: hint } });
      await requestRegionChange({ providerId: 'kizunaai_qwen', to: 'cn', origin: 'list', track });
      expect(useRegionRecommendationStore.getState().records.kizunaai_qwen?.status).toBe('hint');
      await requestRegionChange({ providerId: 'kizunaai_qwen', to: 'cn', origin: 'select', track });
      expect(track).not.toHaveBeenCalled();
    });

    it('a select change without a tracker still records chose-manually', async () => {
      useRegionRecommendationStore.setState({ records: { kizunaai_qwen: hint } });
      await expect(requestRegionChange({ providerId: 'kizunaai_qwen', to: 'cn', origin: 'select' })).resolves.toBe(true);
      expect(useRegionRecommendationStore.getState().records.kizunaai_qwen?.status).toBe('chose-manually');
    });
  });
});
