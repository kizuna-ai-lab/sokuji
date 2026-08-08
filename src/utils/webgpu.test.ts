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
    expect(result).toEqual({ available: false, features: [], softwareOnly: false });
  });

  it('returns available=false when requestAdapter returns null', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(null) } });
    const { checkWebGPU } = await loadModule();
    const result = await checkWebGPU();
    expect(result).toEqual({ available: false, features: [], softwareOnly: false });
  });

  it('returns available=true with empty features when no shader-f16', async () => {
    const mockAdapter = { features: new Set() };
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(mockAdapter) } });
    const { checkWebGPU } = await loadModule();
    const result = await checkWebGPU();
    expect(result).toEqual({ available: true, features: [], softwareOnly: false });
  });

  it('returns shader-f16 in features when adapter supports it', async () => {
    const mockAdapter = { features: new Set(['shader-f16']) };
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(mockAdapter) } });
    const { checkWebGPU } = await loadModule();
    const result = await checkWebGPU();
    expect(result).toEqual({ available: true, features: ['shader-f16'], softwareOnly: false });
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

describe('software adapter detection (issue #389)', () => {
  // Measured on Electron 40.8.5: a real GPU reports vendor "nvidia" with an
  // empty architecture, while the CPU fallback reports vendor "google" /
  // architecture "swiftshader". isFallbackAdapter is not exposed, so the
  // adapter identity is all we have to go on.
  it('flags the SwiftShader fallback Chromium uses when Vulkan is unavailable', async () => {
    const mockAdapter = {
      features: new Set(),
      info: { vendor: 'google', architecture: 'swiftshader', device: '', description: '' },
    };
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(mockAdapter) } });
    const { checkWebGPU } = await loadModule();
    const result = await checkWebGPU();
    expect(result).toEqual({ available: true, features: [], softwareOnly: true });
  });

  it('does not flag a real GPU', async () => {
    const mockAdapter = {
      features: new Set(),
      info: { vendor: 'nvidia', architecture: '', device: '', description: '' },
    };
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(mockAdapter) } });
    const { checkWebGPU } = await loadModule();
    expect((await checkWebGPU()).softwareOnly).toBe(false);
  });

  it('flags Mesa CPU rasterisers too', async () => {
    for (const architecture of ['lavapipe', 'llvmpipe']) {
      vi.resetModules();
      const mockAdapter = { features: new Set(), info: { vendor: 'mesa', architecture } };
      vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(mockAdapter) } });
      const { checkWebGPU } = await import('./webgpu');
      expect((await checkWebGPU()).softwareOnly).toBe(true);
    }
  });

  it('treats a missing adapter info as hardware rather than crying wolf', async () => {
    const mockAdapter = { features: new Set() };   // older Chromium: no .info
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(mockAdapter) } });
    const { checkWebGPU } = await loadModule();
    expect((await checkWebGPU()).softwareOnly).toBe(false);
  });
});

describe('isGpuAccelerationMissing', () => {
  it('is true when WebGPU is absent or software-backed, false on a real GPU', async () => {
    const { isGpuAccelerationMissing } = await loadModule();
    expect(isGpuAccelerationMissing({ available: false, features: [], softwareOnly: false })).toBe(true);
    expect(isGpuAccelerationMissing({ available: true, features: [], softwareOnly: true })).toBe(true);
    expect(isGpuAccelerationMissing({ available: true, features: [], softwareOnly: false })).toBe(false);
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
