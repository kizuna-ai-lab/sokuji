import { describe, it, expect } from 'vitest';
import { SONIOX_REGIONS } from '../soniox/regions';
import { REGION_FAMILIES, RECOMMENDED_PROVIDER_IDS, isRecommendedProvider, currentRegion, REGION_FAMILY_OF } from './regionalProviders';

describe('regionalProviders', () => {
  it('probes tts-rt for Soniox and the maas origin for Qwen; a new Soniox region joins automatically', () => {
    expect(REGION_FAMILIES.soniox.regions).toBe(SONIOX_REGIONS);
    expect(REGION_FAMILIES.soniox.probeUrl('in')).toBe('https://tts-rt.in.soniox.com/');
    expect(REGION_FAMILIES.soniox.probeUrl('us')).toBe('https://tts-rt.soniox.com/');
    expect(REGION_FAMILIES.qwen.probeUrl('sg')).toBe('https://maas.qwencloudapi.com/');
    expect(REGION_FAMILIES.qwen.probeUrl('cn')).toBe('https://maas.qianwenaiapi.com/');
  });
  it('recommends only for the managed providers', () => {
    expect(RECOMMENDED_PROVIDER_IDS).toEqual(['kizunaai_soniox', 'kizunaai_qwen']);
    expect(isRecommendedProvider('soniox')).toBe(false);
    expect(isRecommendedProvider('kizunaai_soniox')).toBe(true);
    expect(isRecommendedProvider(null)).toBe(false);
    expect(currentRegion('kizunaai_qwen', { region: 'mars' })).toBe('sg');
    expect(currentRegion('soniox', { region: 'in' })).toBe('in');
    expect(currentRegion('soniox', undefined)).toBe('us');
  });
  it('own-key and managed Soniox share a family', () => {
    expect(REGION_FAMILY_OF.soniox).toBe(REGION_FAMILY_OF.kizunaai_soniox);
  });
});
