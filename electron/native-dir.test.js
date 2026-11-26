import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveNativeDir } from './native-dir.js';

describe('resolveNativeDir', () => {
  it('SOKUJI_NATIVE_DIR wins', () => {
    expect(resolveNativeDir({ isPackaged: true, resourcesPath: '/r', env: { SOKUJI_NATIVE_DIR: '/mine' }, repoRoot: '/repo' })).toBe('/mine');
  });
  it('a packaged app keeps it beside its other extra resources', () => {
    expect(resolveNativeDir({ isPackaged: true, resourcesPath: '/app/resources', env: {}, repoRoot: '/repo' })).toBe(path.join('/app/resources', 'resources', 'native'));
  });
  it('a checkout keeps it under resources/native', () => {
    expect(resolveNativeDir({ isPackaged: false, resourcesPath: '/x', env: {}, repoRoot: '/repo' })).toBe(path.join('/repo', 'resources', 'native'));
  });
});
