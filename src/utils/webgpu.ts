let cachedResult: boolean | null = null;

export async function checkWebGPU(): Promise<boolean> {
  if (cachedResult !== null) return cachedResult;
  try {
    const gpu = (navigator as any).gpu;
    if (!gpu) { cachedResult = false; return false; }
    const adapter = await gpu.requestAdapter();
    cachedResult = !!adapter;
  } catch { cachedResult = false; }
  return cachedResult;
}

export function isWebGPUAvailable(): boolean {
  return cachedResult ?? false;
}
