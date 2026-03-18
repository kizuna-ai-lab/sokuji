export interface WebGPUCapabilities {
  available: boolean;
  features: string[];
}

let cached: WebGPUCapabilities | null = null;

export async function checkWebGPU(): Promise<WebGPUCapabilities> {
  if (cached) return cached;
  try {
    const gpu = (navigator as any).gpu;
    if (!gpu) {
      cached = { available: false, features: [] };
      return cached;
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      cached = { available: false, features: [] };
      return cached;
    }
    const features: string[] = [];
    if (adapter.features.has('shader-f16')) features.push('shader-f16');

    // Dev override: localStorage.setItem('debug:webgpu-features', 'shader-f16') to force enable
    //               localStorage.setItem('debug:webgpu-features', '')            to force disable features
    //               localStorage.removeItem('debug:webgpu-features')             to use real detection
    try {
      const override = localStorage.getItem('debug:webgpu-features');
      if (override !== null) {
        const overrideFeatures = override ? override.split(',').map(s => s.trim()).filter(Boolean) : [];
        console.debug(`[webgpu] Dev override active: features=${JSON.stringify(overrideFeatures)} (real: ${JSON.stringify(features)})`);
        cached = { available: true, features: overrideFeatures };
        return cached;
      }
    } catch { /* localStorage unavailable in restricted contexts */ }

    cached = { available: true, features };
  } catch {
    cached = { available: false, features: [] };
  }
  return cached;
}

export function getDeviceFeatures(): string[] {
  return cached?.features ?? [];
}

/** @deprecated Use checkWebGPU().available instead */
export function isWebGPUAvailable(): boolean {
  return cached?.available ?? false;
}
