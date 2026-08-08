export interface WebGPUCapabilities {
  available: boolean;
  features: string[];
  /**
   * WebGPU works, but only through a CPU rasteriser (SwiftShader / lavapipe),
   * so inference runs orders of magnitude slower than on a real GPU. Chromium
   * falls back to this silently -- notably on Wayland, where Vulkan cannot be
   * enabled and Dawn is left with no hardware backend (issue #389).
   */
  softwareOnly: boolean;
}

/** Names CPU rasterisers report themselves under in GPUAdapterInfo. */
const SOFTWARE_ADAPTER = /swiftshader|lavapipe|llvmpipe|softpipe|software/i;

function isSoftwareAdapter(adapter: any): boolean {
  const info = adapter?.info;
  if (!info) return false;
  return [info.architecture, info.vendor, info.device, info.description]
    .some(field => typeof field === 'string' && SOFTWARE_ADAPTER.test(field));
}

let cached: WebGPUCapabilities | null = null;

export async function checkWebGPU(): Promise<WebGPUCapabilities> {
  if (cached) return cached;
  try {
    const gpu = (navigator as any).gpu;
    if (!gpu) {
      cached = { available: false, features: [], softwareOnly: false };
      return cached;
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      cached = { available: false, features: [], softwareOnly: false };
      return cached;
    }
    const softwareOnly = isSoftwareAdapter(adapter);
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
        cached = { available: true, features: overrideFeatures, softwareOnly };
        return cached;
      }
    } catch { /* localStorage unavailable in restricted contexts */ }

    cached = { available: true, features, softwareOnly };
  } catch {
    cached = { available: false, features: [], softwareOnly: false };
  }
  return cached;
}

/** True when WebGPU is missing entirely or is backed by a CPU rasteriser. */
export function isGpuAccelerationMissing(caps: WebGPUCapabilities): boolean {
  return !caps.available || caps.softwareOnly;
}

export function getDeviceFeatures(): string[] {
  return cached?.features ?? [];
}

/** @deprecated Use checkWebGPU().available instead */
export function isWebGPUAvailable(): boolean {
  return cached?.available ?? false;
}
