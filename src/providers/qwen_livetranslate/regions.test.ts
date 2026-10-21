import { describe, it, expect } from 'vitest';
import { asQwenRegion, DEFAULT_QWEN_REGION, QWEN_REGION_LABELS, QWEN_REGIONS } from './regions';

describe("managed Qwen's regions", () => {
  it('offers Singapore and Beijing, Singapore first and by default', () => {
    expect(QWEN_REGIONS).toEqual(['sg', 'cn']);
    expect(DEFAULT_QWEN_REGION).toBe('sg');
  });

  it('names each place in its own language, not through a catalog', () => {
    expect(QWEN_REGION_LABELS).toEqual({ sg: 'Singapore', cn: '北京 (Beijing)' });
  });

  it('narrows anything that is not a region to Singapore', () => {
    expect(asQwenRegion('cn')).toBe('cn');
    expect(asQwenRegion('sg')).toBe('sg');
    expect(asQwenRegion(undefined)).toBe('sg');
    expect(asQwenRegion('us')).toBe('sg');
    expect(asQwenRegion(3)).toBe('sg');
  });
});
