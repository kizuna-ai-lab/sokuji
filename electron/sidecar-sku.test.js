import { describe, it, expect } from 'vitest';
import path from 'path';
import { detectSku, bundleRootFor, parseGpuName } from './sidecar-sku.js';

describe('detectSku (spec D10)', () => {
  it('darwin arm64 -> mac regardless of nvidia', () => {
    expect(detectSku('darwin', { hasNvidia: false, arch: 'arm64' })).toBe('mac');
    expect(detectSku('darwin', { hasNvidia: true, arch: 'arm64' })).toBe('mac');
  });
  it('darwin x64 (Intel mac) -> null, no bundle exists', () => {
    expect(detectSku('darwin', { hasNvidia: false, arch: 'x64' })).toBeNull();
  });
  it('nvidia present -> win-nvidia on windows, linux-nvidia on linux', () => {
    expect(detectSku('win32', { hasNvidia: true, arch: 'x64' })).toBe('win-nvidia');
    expect(detectSku('linux', { hasNvidia: true, arch: 'x64' })).toBe('linux-nvidia');
  });
  it('non-nvidia windows -> win-directml', () => {
    expect(detectSku('win32', { hasNvidia: false, arch: 'x64' })).toBe('win-directml');
  });
  it('non-nvidia linux -> linux-nvidia bundle (CPU fallback, D10 open item)', () => {
    expect(detectSku('linux', { hasNvidia: false, arch: 'x64' })).toBe('linux-nvidia');
  });
  it('linux arm64 -> linux-arm64 regardless of nvidia (CPU ORT + ggml/Vulkan lane)', () => {
    expect(detectSku('linux', { hasNvidia: true, arch: 'arm64' })).toBe('linux-arm64');   // Jetson / DGX Spark
    expect(detectSku('linux', { hasNvidia: false, arch: 'arm64' })).toBe('linux-arm64');
  });
  it('non-x64 windows and other linux arches -> null (no bundles exist; honest beats exec-format-error)', () => {
    expect(detectSku('win32', { hasNvidia: true, arch: 'arm64' })).toBeNull();   // Windows-on-ARM
    expect(detectSku('win32', { hasNvidia: false, arch: 'arm64' })).toBeNull();
    expect(detectSku('linux', { hasNvidia: false, arch: 'riscv64' })).toBeNull();
  });
});

describe('bundleRootFor', () => {
  it('joins userData/sidecar/<sku>', () => {
    expect(bundleRootFor('/u', 'win-directml')).toBe(path.join('/u', 'sidecar', 'win-directml'));
  });
});

describe('parseGpuName', () => {
  it('extracts the marketing name from nvidia-smi -L', () => {
    expect(parseGpuName('GPU 0: NVIDIA GeForce RTX 4070 (UUID: GPU-1234)\n'))
      .toBe('NVIDIA GeForce RTX 4070');
  });
  it('returns null on empty/garbage output', () => {
    expect(parseGpuName('')).toBeNull();
    expect(parseGpuName(undefined)).toBeNull();
    expect(parseGpuName('No devices found')).toBeNull();
  });
});
