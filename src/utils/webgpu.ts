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
