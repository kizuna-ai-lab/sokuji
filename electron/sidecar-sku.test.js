import { describe, it, expect } from 'vitest';
import path from 'path';
import { detectSku, bundleRootFor } from './sidecar-sku.js';

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
});

describe('bundleRootFor', () => {
  it('joins userData/sidecar/<sku>', () => {
    expect(bundleRootFor('/u', 'win-directml')).toBe(path.join('/u', 'sidecar', 'win-directml'));
  });
});
