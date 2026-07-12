import { describe, it, expect } from 'vitest';
import { modelUsable, deviceReady, type ModelManifestEntry, type ModelStatus } from './modelManifest';

// Minimal entry factory — only the fields modelUsable reads.
function entry(over: Partial<ModelManifestEntry>): ModelManifestEntry {
  return { id: 'm', type: 'asr', name: 'M', languages: [], ...over } as ModelManifestEntry;
}
const ctx = (statuses: Record<string, ModelStatus>, webgpu: boolean) => ({
  modelStatuses: statuses, webgpuAvailable: webgpu,
});

describe('modelUsable', () => {
  it('is false for a missing entry', () => {
    expect(modelUsable(undefined, ctx({}, true))).toBe(false);
    expect(modelUsable(null, ctx({}, true))).toBe(false);
  });

  it('requires a downloaded status for non-cloud models', () => {
    const e = entry({ id: 'a' });
    expect(modelUsable(e, ctx({ a: 'downloaded' }, true))).toBe(true);
    expect(modelUsable(e, ctx({ a: 'not_downloaded' }, true))).toBe(false);
    expect(modelUsable(e, ctx({}, true))).toBe(false);
  });

  it('treats cloud models as usable regardless of download status', () => {
    const e = entry({ id: 'c', isCloudModel: true });
    expect(modelUsable(e, ctx({}, true))).toBe(true);
    expect(modelUsable(e, ctx({ c: 'not_downloaded' }, false))).toBe(true);
  });

  it('rejects a webgpu-required model when webgpu is unavailable', () => {
    const e = entry({ id: 'g', requiredDevice: 'webgpu' });
    expect(modelUsable(e, ctx({ g: 'downloaded' }, true))).toBe(true);
    expect(modelUsable(e, ctx({ g: 'downloaded' }, false))).toBe(false);
  });

  it('a cloud webgpu model still needs webgpu', () => {
    const e = entry({ id: 'cg', isCloudModel: true, requiredDevice: 'webgpu' });
    expect(modelUsable(e, ctx({}, false))).toBe(false);
    expect(modelUsable(e, ctx({}, true))).toBe(true);
  });
});

describe('deviceReady', () => {
  it('is true for models with no device requirement, regardless of webgpu', () => {
    expect(deviceReady(entry({}), false)).toBe(true);
    expect(deviceReady(entry({}), true)).toBe(true);
  });

  it('gates webgpu-required models on webgpu availability', () => {
    const g = entry({ requiredDevice: 'webgpu' });
    expect(deviceReady(g, true)).toBe(true);
    expect(deviceReady(g, false)).toBe(false);
  });

  it('treats a missing entry as device-ready (null-safe)', () => {
    // A device-only filter never rejects on a null entry; readiness (modelUsable)
    // is where a missing entry becomes unusable.
    expect(deviceReady(null, false)).toBe(true);
  });
});
