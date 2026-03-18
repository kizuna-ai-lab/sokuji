import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must reset module between tests to clear cached result
async function loadModule() {
  vi.resetModules();
  return import('./webgpu');
}

describe('checkWebGPU', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {});
  });

  it('returns available=false when navigator.gpu is undefined', async () => {
    const { checkWebGPU } = await loadModule();
    const result = await checkWebGPU();
    expect(result).toEqual({ available: false, features: [] });
  });

  it('returns available=false when requestAdapter returns null', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(null) } });
    const { checkWebGPU } = await loadModule();
    const result = await checkWebGPU();
    expect(result).toEqual({ available: false, features: [] });
  });

  it('returns available=true with empty features when no shader-f16', async () => {
    const mockAdapter = { features: new Set() };
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(mockAdapter) } });
    const { checkWebGPU } = await loadModule();
    const result = await checkWebGPU();
    expect(result).toEqual({ available: true, features: [] });
  });

  it('returns shader-f16 in features when adapter supports it', async () => {
    const mockAdapter = { features: new Set(['shader-f16']) };
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(mockAdapter) } });
    const { checkWebGPU } = await loadModule();
    const result = await checkWebGPU();
    expect(result).toEqual({ available: true, features: ['shader-f16'] });
  });

  it('caches the result on subsequent calls', async () => {
    const requestAdapter = vi.fn().mockResolvedValue({ features: new Set() });
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    const { checkWebGPU } = await loadModule();
    await checkWebGPU();
    await checkWebGPU();
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });
});

describe('getDeviceFeatures', () => {
  it('returns empty array before checkWebGPU is called', async () => {
    const { getDeviceFeatures } = await loadModule();
    expect(getDeviceFeatures()).toEqual([]);
  });

  it('returns features after checkWebGPU is called', async () => {
    const mockAdapter = { features: new Set(['shader-f16']) };
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(mockAdapter) } });
    const { checkWebGPU, getDeviceFeatures } = await loadModule();
    await checkWebGPU();
    expect(getDeviceFeatures()).toEqual(['shader-f16']);
  });
});
