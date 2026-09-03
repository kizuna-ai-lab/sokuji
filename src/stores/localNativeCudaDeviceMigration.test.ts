import { describe, it, expect } from 'vitest';
import { migrateLegacyCudaDevice } from './settingsStore';

/**
 * The localNative per-stage device override was renamed from 'cuda' (a
 * leftover from the ONNX/CUDA era) to 'gpu' (the sidecar now runs ggml over
 * Vulkan or Metal, not CUDA specifically). A persisted 'cuda' must read back
 * as 'gpu' on settings load so a user who previously forced GPU keeps that
 * choice — see settingsStore.loadSettings, which applies this migration to
 * the localNative slice right after loading it.
 */
describe('localNative legacy cuda device migration', () => {
  it("rewrites a persisted 'cuda' override to 'gpu' on every stage", () => {
    expect(migrateLegacyCudaDevice({ asrDevice: 'cuda' as any, translationDevice: 'cuda' as any, ttsDevice: 'cuda' as any }))
      .toEqual({ asrDevice: 'gpu', translationDevice: 'gpu', ttsDevice: 'gpu' });
  });

  it('leaves auto/cpu/gpu untouched', () => {
    expect(migrateLegacyCudaDevice({ asrDevice: 'auto', translationDevice: 'cpu', ttsDevice: 'gpu' }))
      .toEqual({ asrDevice: 'auto', translationDevice: 'cpu', ttsDevice: 'gpu' });
  });

  it('migrates stages independently — only the cuda ones change', () => {
    expect(migrateLegacyCudaDevice({ asrDevice: 'cuda' as any, translationDevice: 'auto', ttsDevice: 'cpu' }))
      .toEqual({ asrDevice: 'gpu', translationDevice: 'auto', ttsDevice: 'cpu' });
  });
});
