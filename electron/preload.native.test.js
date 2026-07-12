import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INVOKE_CHANNELS } from './ipc-channels.js';

// The native-host + sidecar-bundle invoke channels now live in the shared
// ipc-channels registry (preload derives its allowlist from it); the
// bundle-progress event stays a receive channel in preload.js.
describe('native / sidecar IPC channels are exposed', () => {
  it('native-host invoke channels are in the registry', () => {
    for (const ch of ['native-host:start', 'native-host:stop', 'native-host:status']) {
      expect(INVOKE_CHANNELS).toContain(ch);
    }
  });

  it('sidecar-bundle invoke channels are in the registry', () => {
    for (const ch of [
      'sidecar-bundle:status', 'sidecar-bundle:install', 'sidecar-bundle:cancel',
      'sidecar-bundle:manifest', 'sidecar-bundle:remove',
    ]) {
      expect(INVOKE_CHANNELS).toContain(ch);
    }
  });

  it('the bundle-progress receive channel stays in preload', () => {
    const src = readFileSync(join(__dirname, 'preload.js'), 'utf8');
    expect(src).toContain("'sidecar-bundle-progress'");
  });
});
