import { describe, it, expect } from 'vitest';
import path from 'path';
import * as sidecarSku from './sidecar-sku.js';
import { detectSku, bundleRootFor } from './sidecar-sku.js';

describe('detectSku (spec §7 — platform-named SKUs)', () => {
  it('linux x64 -> linux-x64', () => {
    expect(detectSku('linux', { arch: 'x64' })).toBe('linux-x64');
  });
  it('linux arm64 -> linux-arm64', () => {
    expect(detectSku('linux', { arch: 'arm64' })).toBe('linux-arm64');
  });
  it('windows x64 -> win-x64', () => {
    expect(detectSku('win32', { arch: 'x64' })).toBe('win-x64');
  });
  it('darwin arm64 -> mac-arm64', () => {
    expect(detectSku('darwin', { arch: 'arm64' })).toBe('mac-arm64');
  });
  it('darwin x64 -> mac-x64 (new capability — was null)', () => {
    expect(detectSku('darwin', { arch: 'x64' })).toBe('mac-x64');
  });
  it('unsupported arches -> null (no bundle exists; honest beats exec-format-error)', () => {
    expect(detectSku('win32', { arch: 'arm64' })).toBeNull();     // Windows-on-ARM
    expect(detectSku('linux', { arch: 'riscv64' })).toBeNull();
    expect(detectSku('darwin', { arch: 'arm' })).toBeNull();
  });
});

describe('detectSku no longer takes a GPU-vendor signal', () => {
  it('the NVIDIA probe is gone from the module surface', () => {
    expect(sidecarSku.probeNvidia).toBeUndefined();
    expect(sidecarSku.nvidiaGpuName).toBeUndefined();
    expect(sidecarSku.parseGpuName).toBeUndefined();
  });
});

describe('bundleRootFor', () => {
  it('joins userData/sidecar/<sku>', () => {
    expect(bundleRootFor('/u', 'win-x64')).toBe(path.join('/u', 'sidecar', 'win-x64'));
  });
});
