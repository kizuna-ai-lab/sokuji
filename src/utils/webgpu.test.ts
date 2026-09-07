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
    expect(result).toEqual({ available: false, features: [], softwareOnly: false, adapterInfo: null });
  });

  it('returns available=false when requestAdapter keeps returning null', async () => {
    vi.useFakeTimers();
    try {
      const requestAdapter = vi.fn().mockResolvedValue(null);
      vi.stubGlobal('navigator', { gpu: { requestAdapter } });
      const { checkWebGPU } = await loadModule();
      const pending = checkWebGPU();
      await vi.runAllTimersAsync();
      expect(await pending).toEqual({ available: false, features: [], softwareOnly: false, adapterInfo: null });
      // Gave the GPU process more than one chance before believing it.
      expect(requestAdapter).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns available=true with empty features when no shader-f16', async () => {
    const mockAdapter = { features: new Set() };
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(mockAdapter) } });
    const { checkWebGPU } = await loadModule();
    const result = await checkWebGPU();
    expect(result).toEqual({ available: true, features: [], softwareOnly: false, adapterInfo: null });
  });

  it('returns shader-f16 in features when adapter supports it', async () => {
    const mockAdapter = { features: new Set(['shader-f16']) };
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(mockAdapter) } });
    const { checkWebGPU } = await loadModule();
    const result = await checkWebGPU();
    expect(result).toEqual({ available: true, features: ['shader-f16'], softwareOnly: false, adapterInfo: null });
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
    expect(result).toEqual({
      available: true,
      features: [],
      softwareOnly: true,
      adapterInfo: { vendor: 'google', architecture: 'swiftshader' },
    });
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
    expect(isGpuAccelerationMissing({ available: false, features: [], softwareOnly: false, adapterInfo: null })).toBe(true);
    expect(isGpuAccelerationMissing({ available: true, features: [], softwareOnly: true, adapterInfo: null })).toBe(true);
    expect(isGpuAccelerationMissing({ available: true, features: [], softwareOnly: false, adapterInfo: null })).toBe(false);
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

describe('getAdapterInfo', () => {
  it('reports the adapter identity, dropping the fields Chromium leaves blank', async () => {
    const mockAdapter = {
      features: new Set(),
      info: { vendor: 'intel', architecture: 'gen-12lp', device: '', description: 'Intel(R) UHD Graphics' },
    };
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(mockAdapter) } });
    const { checkWebGPU, getAdapterInfo } = await loadModule();
    await checkWebGPU();
    expect(getAdapterInfo()).toEqual({
      vendor: 'intel',
      architecture: 'gen-12lp',
      description: 'Intel(R) UHD Graphics',
    });
  });

  it('is null before the probe runs, and on a Chromium too old to expose .info', async () => {
    const { checkWebGPU, getAdapterInfo } = await loadModule();
    expect(getAdapterInfo()).toBeNull();
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve({ features: new Set() }) } });
    await checkWebGPU();
    expect(getAdapterInfo()).toBeNull();
  });

  it('probes once when concurrent callers race at startup', async () => {
    const requestAdapter = vi.fn().mockResolvedValue({ features: new Set() });
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    const { checkWebGPU } = await loadModule();
    await Promise.all([checkWebGPU(), checkWebGPU(), checkWebGPU()]);
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });
});

describe('the startup adapter race (Windows)', () => {
  // Measured on the Windows box: requestAdapter() in the first ~50-100 ms of a
  // renderer's life resolves to null instead of waiting for the GPU process.
  // Caching that null permanently made the app treat a 4070 SUPER as having no
  // GPU for the rest of the session.
  it('retries a null answer and reports the adapter that eventually arrives', async () => {
    vi.useFakeTimers();
    try {
      const requestAdapter = vi.fn()
        .mockResolvedValueOnce(null)                                  // asked at ~0 ms
        .mockResolvedValue({ features: new Set(['shader-f16']), info: { vendor: 'nvidia' } });
      vi.stubGlobal('navigator', { gpu: { requestAdapter } });
      const { checkWebGPU } = await loadModule();
      const pending = checkWebGPU();
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.available).toBe(true);
      expect(result.features).toEqual(['shader-f16']);
      expect(result.adapterInfo).toEqual({ vendor: 'nvidia' });
      expect(requestAdapter).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry once an adapter has answered', async () => {
    const requestAdapter = vi.fn().mockResolvedValue({ features: new Set() });
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    const { checkWebGPU } = await loadModule();
    await checkWebGPU();
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });

  it('does not retry a software adapter — that is an answer, not a machine waking up', async () => {
    const requestAdapter = vi.fn().mockResolvedValue({
      features: new Set(),
      info: { vendor: 'google', architecture: 'swiftshader' },
    });
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    const { checkWebGPU } = await loadModule();
    expect((await checkWebGPU()).softwareOnly).toBe(true);
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });

  it('does not retry when there is no WebGPU at all', async () => {
    vi.stubGlobal('navigator', {});
    const { checkWebGPU } = await loadModule();
    expect((await checkWebGPU()).available).toBe(false);
  });

  it('does not retry a requestAdapter that throws — that is a real failure', async () => {
    const requestAdapter = vi.fn().mockRejectedValue(new Error('device lost'));
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    const { checkWebGPU } = await loadModule();
    expect((await checkWebGPU()).available).toBe(false);
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });
});
