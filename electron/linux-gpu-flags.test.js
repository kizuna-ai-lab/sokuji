import { describe, it, expect } from 'vitest';
import { resolveLinuxGpuFeatures, VULKAN_FEATURES, NO_VULKAN_FEATURES } from './linux-gpu-flags.js';

const waylandEnv = { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' };
const x11Env = { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' };

describe('resolveLinuxGpuFeatures (issue #389)', () => {
  it('keeps Vulkan off Linux — Wayland is not involved on win32/darwin', () => {
    for (const platform of ['win32', 'darwin']) {
      expect(resolveLinuxGpuFeatures({ platform, effectivePlatform: '', env: {} })).toBe(VULKAN_FEATURES);
    }
  });

  it('keeps Vulkan on X11', () => {
    expect(resolveLinuxGpuFeatures({ platform: 'linux', effectivePlatform: 'x11', env: x11Env }))
      .toBe(VULKAN_FEATURES);
  });

  it('drops Vulkan on Wayland — it would leave the window permanently unmapped', () => {
    expect(resolveLinuxGpuFeatures({ platform: 'linux', effectivePlatform: 'wayland', env: waylandEnv }))
      .toBe(NO_VULKAN_FEATURES);
  });

  it('drops Vulkan on Wayland even when XWayland is available', () => {
    // DISPLAY being set does NOT mean we render through X: Electron already
    // picked wayland before this code ran, and it is too late to change that.
    expect(resolveLinuxGpuFeatures({
      platform: 'linux',
      effectivePlatform: 'wayland',
      env: { ...waylandEnv, DISPLAY: ':0' },
    })).toBe(NO_VULKAN_FEATURES);
  });

  // Electron resolves --ozone-platform / --ozone-platform-hint / duplicate
  // switches before the main script runs, so the resolved value is all we read.
  describe('trusts the platform Electron resolved', () => {
    it('keeps Vulkan when the user forced x11 on a Wayland box (the #389 workaround)', () => {
      expect(resolveLinuxGpuFeatures({
        platform: 'linux',
        effectivePlatform: 'x11',       // from --ozone-platform=x11
        env: waylandEnv,
      })).toBe(VULKAN_FEATURES);
    });

    it('drops Vulkan when a duplicate switch resolves to wayland (last occurrence wins)', () => {
      // --ozone-platform=x11 --ozone-platform=wayland -> Chromium keeps "wayland".
      // Disagreeing with that and leaving Vulkan on would recreate the bug.
      expect(resolveLinuxGpuFeatures({
        platform: 'linux', effectivePlatform: 'wayland', env: waylandEnv,
      })).toBe(NO_VULKAN_FEATURES);
    });

    it('keeps Vulkan when a duplicate switch resolves to x11', () => {
      // --ozone-platform=wayland --ozone-platform=x11 -> Chromium keeps "x11".
      expect(resolveLinuxGpuFeatures({
        platform: 'linux', effectivePlatform: 'x11', env: { ...waylandEnv, DISPLAY: ':0' },
      })).toBe(VULKAN_FEATURES);
    });
  });

  describe('env fallback when the resolved platform is unavailable', () => {
    it('treats a bare WAYLAND_DISPLAY as a Wayland session', () => {
      expect(resolveLinuxGpuFeatures({
        platform: 'linux', effectivePlatform: '', env: { WAYLAND_DISPLAY: 'wayland-0' },
      })).toBe(NO_VULKAN_FEATURES);
    });

    it('treats XDG_SESSION_TYPE=wayland as a Wayland session', () => {
      expect(resolveLinuxGpuFeatures({
        platform: 'linux', effectivePlatform: '', env: { XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' },
      })).toBe(NO_VULKAN_FEATURES);
    });

    it('keeps Vulkan when nothing suggests Wayland', () => {
      expect(resolveLinuxGpuFeatures({ platform: 'linux', effectivePlatform: '', env: x11Env }))
        .toBe(VULKAN_FEATURES);
    });
  });

  it('always keeps SharedArrayBuffer — the audio ring buffer (#174) needs it', () => {
    const cases = [
      { effectivePlatform: 'x11', env: x11Env },
      { effectivePlatform: 'wayland', env: waylandEnv },
      { effectivePlatform: 'wayland', env: { ...waylandEnv, DISPLAY: ':0' } },
      { effectivePlatform: '', env: {} },
    ];
    for (const c of cases) {
      expect(resolveLinuxGpuFeatures({ platform: 'linux', ...c }).split(','))
        .toContain('SharedArrayBuffer');
    }
  });
});
