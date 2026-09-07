/** What the adapter calls itself, with the empty fields dropped. */
export interface GpuAdapterInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}

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
  /**
   * The adapter's own identity, when Chromium exposes it (older builds have no
   * `.info`, and it is null there). Reported in telemetry so a support case can
   * name the GPU without asking the user to open chrome://gpu -- an Intel iGPU
   * and a discrete NVIDIA disagree about `shader-f16`, and that disagreement is
   * what a "requires f16 but the device does not support it" report looks like.
   */
  adapterInfo: GpuAdapterInfo | null;
}

/** Names CPU rasterisers report themselves under in GPUAdapterInfo. */
const SOFTWARE_ADAPTER = /swiftshader|lavapipe|llvmpipe|softpipe|software/i;

function isSoftwareAdapter(adapter: any): boolean {
  const info = adapter?.info;
  if (!info) return false;
  return [info.architecture, info.vendor, info.device, info.description]
    .some(field => typeof field === 'string' && SOFTWARE_ADAPTER.test(field));
}

/**
 * Adapter identity with the blanks dropped. Chromium leaves fields it has no
 * value for as '', and an empty string in telemetry reads as "we asked and the
 * answer was nothing" rather than "not reported".
 */
function readAdapterInfo(adapter: any): GpuAdapterInfo | null {
  const info = adapter?.info;
  if (!info) return null;
  const out: GpuAdapterInfo = {};
  for (const key of ['vendor', 'architecture', 'device', 'description'] as const) {
    const value = info[key];
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * How many times to ask for an adapter before believing there is none, and how
 * long to wait between asks.
 *
 * Measured on the Windows box (RTX 4070 SUPER, Electron 40.8.5, a shown window
 * and the app's own GPU flags): a `requestAdapter()` issued in the first
 * ~50-100 ms of a renderer's life resolves to `null` rather than waiting for
 * the GPU process — null when asked at 0 ms and at 50 ms, a working adapter
 * from 100 ms on, and from 250 ms on it answers in under 50 ms. macOS (M4) and
 * Linux (GB10) answered on the first ask at 0 ms.
 *
 * Losing that race used to poison the whole session, because the null was
 * cached permanently: `getDeviceFeatures()` stayed empty so no f16 variant
 * could ever be selected, `isModelReady()` reported downloaded f16 models as
 * missing, and the no-acceleration notice appeared — on a machine with a
 * 4070 SUPER in it.
 *
 * Only a `null` answer is retried. A returned adapter is an answer, including
 * a software one, and a `requestAdapter()` that throws is a real failure rather
 * than a machine still waking up.
 */
const ADAPTER_ATTEMPTS = 4;
const ADAPTER_RETRY_MS = 150;

async function requestAdapterWithRetry(gpu: any): Promise<any> {
  for (let attempt = 0; attempt < ADAPTER_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, ADAPTER_RETRY_MS));
    const adapter = await gpu.requestAdapter();
    if (adapter) return adapter;
  }
  return null;
}

let cached: WebGPUCapabilities | null = null;
// Startup fires several probes at once (the model store, the app_startup
// telemetry). Caching the promise as well as the result keeps that to one
// requestAdapter() -- `cached` alone is only assigned after the await.
let inFlight: Promise<WebGPUCapabilities> | null = null;

export async function checkWebGPU(): Promise<WebGPUCapabilities> {
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = probeWebGPU().finally(() => { inFlight = null; });
  return inFlight;
}

async function probeWebGPU(): Promise<WebGPUCapabilities> {
  try {
    const gpu = (navigator as any).gpu;
    if (!gpu) {
      cached = { available: false, features: [], softwareOnly: false, adapterInfo: null };
      return cached;
    }
    const adapter = await requestAdapterWithRetry(gpu);
    if (!adapter) {
      cached = { available: false, features: [], softwareOnly: false, adapterInfo: null };
      return cached;
    }
    const softwareOnly = isSoftwareAdapter(adapter);
    const adapterInfo = readAdapterInfo(adapter);
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
        cached = { available: true, features: overrideFeatures, softwareOnly, adapterInfo };
        return cached;
      }
    } catch { /* localStorage unavailable in restricted contexts */ }

    cached = { available: true, features, softwareOnly, adapterInfo };
  } catch {
    cached = { available: false, features: [], softwareOnly: false, adapterInfo: null };
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

export function getAdapterInfo(): GpuAdapterInfo | null {
  return cached?.adapterInfo ?? null;
}

/** @deprecated Use checkWebGPU().available instead */
export function isWebGPUAvailable(): boolean {
  return cached?.available ?? false;
}
