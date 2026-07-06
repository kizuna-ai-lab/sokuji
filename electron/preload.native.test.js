import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('preload invoke whitelist', () => {
  it('includes the native-host channels', () => {
    const src = readFileSync(join(__dirname, 'preload.js'), 'utf8');
    for (const ch of ['native-host:start', 'native-host:stop', 'native-host:status']) {
      expect(src).toContain(`'${ch}'`);
    }
  });

  it('includes the sidecar-bundle channels', () => {
    const src = readFileSync(join(__dirname, 'preload.js'), 'utf8');
    for (const ch of ['sidecar-bundle:status', 'sidecar-bundle:install', 'sidecar-bundle-progress']) {
      expect(src).toContain(`'${ch}'`);
    }
  });
});
