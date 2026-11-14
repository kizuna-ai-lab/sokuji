import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { requestRegionChange } from './regionChange';

const region = (id: string) => (useProviderStore.getState().entries[id].settings as { region: string }).region;

beforeEach(async () => {
  registerRunPhase(() => 'idle');
  useRegionChangeStore.setState({ question: null });
  useRegionRecommendationStore.setState({ records: {} });
  useProviderStore.setState({ entries: {}, selected: null, selectionLocked: false, intent: undefined });
  await useProviderStore.getState().load(kizunaSonioxProvider);
  await useProviderStore.getState().load(sonioxProvider);
  await useProviderStore.getState().load(kizunaQwenProvider);
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
});
