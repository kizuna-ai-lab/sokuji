import { describe, it, expect } from 'vitest';
import path from 'path';
import { detectSku, bundleRootFor } from './sidecar-sku.js';

describe('detectSku (spec D10)', () => {
  it('darwin -> mac regardless of nvidia', () => {
    expect(detectSku('darwin', { hasNvidia: false })).toBe('mac');
    expect(detectSku('darwin', { hasNvidia: true })).toBe('mac');
  });
  it('nvidia present -> nvidia on win and linux', () => {
    expect(detectSku('win32', { hasNvidia: true })).toBe('nvidia');
    expect(detectSku('linux', { hasNvidia: true })).toBe('nvidia');
  });
  it('non-nvidia windows -> directml', () => {
    expect(detectSku('win32', { hasNvidia: false })).toBe('directml');
  });
  it('non-nvidia linux -> nvidia bundle (CPU fallback, D10 open item)', () => {
    expect(detectSku('linux', { hasNvidia: false })).toBe('nvidia');
  });
});

describe('bundleRootFor', () => {
  it('joins userData/sidecar/<sku>', () => {
    expect(bundleRootFor('/u', 'directml')).toBe(path.join('/u', 'sidecar', 'directml'));
  });
});
