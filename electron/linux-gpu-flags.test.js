import { describe, it, expect } from 'vitest';
import { resolveLinuxGpuFlags, VULKAN_FEATURES, NO_VULKAN_FEATURES } from './linux-gpu-flags.js';

const wayland = { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' };
const x11 = { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' };

describe('resolveLinuxGpuFlags (issue #389)', () => {
  it('keeps Vulkan off Linux — Wayland is not involved on win32/darwin', () => {
    for (const platform of ['win32', 'darwin']) {
      const r = resolveLinuxGpuFlags({ platform, env: {}, argv: [] });
      expect(r.features).toBe(VULKAN_FEATURES);
      expect(r.ozonePlatform).toBeNull();
    }
  });

  it('keeps Vulkan on an X11 session and does not pin the ozone platform', () => {
    const r = resolveLinuxGpuFlags({ platform: 'linux', env: x11, argv: [] });
    expect(r.features).toBe(VULKAN_FEATURES);
    expect(r.ozonePlatform).toBeNull();
  });

  it('runs on XWayland when a Wayland session has an X server, keeping the hardware WebGPU adapter', () => {
    const r = resolveLinuxGpuFlags({ platform: 'linux', env: { ...wayland, DISPLAY: ':0' }, argv: [] });
    expect(r.ozonePlatform).toBe('x11');
    expect(r.features).toBe(VULKAN_FEATURES);
  });

  it('drops Vulkan on a Wayland session with no XWayland — an invisible window is worse than a slow one', () => {
    const r = resolveLinuxGpuFlags({ platform: 'linux', env: wayland, argv: [] });
    expect(r.features).toBe(NO_VULKAN_FEATURES);
    expect(r.ozonePlatform).toBeNull();
  });

  it('treats a bare WAYLAND_DISPLAY (no XDG_SESSION_TYPE) as a Wayland session', () => {
    const r = resolveLinuxGpuFlags({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' }, argv: [] });
    expect(r.features).toBe(NO_VULKAN_FEATURES);
  });

  it('never overrides an explicit --ozone-platform, and drops Vulkan when the user forces wayland', () => {
    const r = resolveLinuxGpuFlags({
      platform: 'linux',
      env: { ...wayland, DISPLAY: ':0' },      // XWayland available, but the user said wayland
      argv: ['/opt/Sokuji/sokuji', '--ozone-platform=wayland'],
    });
    expect(r.ozonePlatform).toBeNull();
    expect(r.features).toBe(NO_VULKAN_FEATURES);
  });

  it('keeps Vulkan when the user forces x11 themselves (the issue #389 workaround)', () => {
    const r = resolveLinuxGpuFlags({
      platform: 'linux',
      env: wayland,
      argv: ['/opt/Sokuji/sokuji', '--ozone-platform=x11'],
    });
    expect(r.ozonePlatform).toBeNull();
    expect(r.features).toBe(VULKAN_FEATURES);
  });

  it('accepts the space-separated switch form', () => {
    const r = resolveLinuxGpuFlags({
      platform: 'linux',
      env: wayland,
      argv: ['/opt/Sokuji/sokuji', '--ozone-platform', 'wayland'],
    });
    expect(r.ozonePlatform).toBeNull();
    expect(r.features).toBe(NO_VULKAN_FEATURES);
  });

  it('resolves --ozone-platform-hint=auto against the session type', () => {
    const onWayland = resolveLinuxGpuFlags({
      platform: 'linux', env: wayland, argv: ['--ozone-platform-hint=auto'],
    });
    expect(onWayland.features).toBe(NO_VULKAN_FEATURES);

    const onX11 = resolveLinuxGpuFlags({
      platform: 'linux', env: x11, argv: ['--ozone-platform-hint=auto'],
    });
    expect(onX11.features).toBe(VULKAN_FEATURES);
  });

  it('honours --ozone-platform-hint=wayland even on an X11 session', () => {
    const r = resolveLinuxGpuFlags({
      platform: 'linux', env: x11, argv: ['--ozone-platform-hint=wayland'],
    });
    expect(r.features).toBe(NO_VULKAN_FEATURES);
    expect(r.ozonePlatform).toBeNull();
  });

  it('lets --ozone-platform win over --ozone-platform-hint', () => {
    const r = resolveLinuxGpuFlags({
      platform: 'linux',
      env: wayland,
      argv: ['--ozone-platform-hint=auto', '--ozone-platform=x11'],
    });
    expect(r.features).toBe(VULKAN_FEATURES);
  });

  it('always keeps SharedArrayBuffer — the audio ring buffer (#174) needs it', () => {
    const envs = [x11, wayland, { ...wayland, DISPLAY: ':0' }, {}];
    for (const env of envs) {
      const r = resolveLinuxGpuFlags({ platform: 'linux', env, argv: [] });
      expect(r.features.split(',')).toContain('SharedArrayBuffer');
    }
  });
});
