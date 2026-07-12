import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { INVOKE_CHANNELS, EXTERNAL_INVOKE_CHANNELS, BRIDGE_ONLY_CHANNELS } from './ipc-channels.js';

// Collect every `ipcMain.handle('X'` channel across the electron main-process
// files, read as text (no need to boot Electron).
function registeredHandlerChannels() {
  const dir = __dirname;
  const channels = new Set();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.js') || file.endsWith('.test.js')) continue;
    const src = readFileSync(join(dir, file), 'utf8');
    for (const m of src.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)) {
      channels.add(m[1]);
    }
  }
  return channels;
}

describe('IPC channel registry drift guard', () => {
  const handlers = registeredHandlerChannels();
  const invokeSet = new Set(INVOKE_CHANNELS);
  const external = new Set(EXTERNAL_INVOKE_CHANNELS);
  const bridge = new Set(BRIDGE_ONLY_CHANNELS);

  it('every allowlisted invoke channel resolves to a handler (or is externally registered)', () => {
    // Catches dead placeholders like the old 'invoke-channel': an allowlist
    // entry with no handler behind it.
    for (const ch of INVOKE_CHANNELS) {
      if (external.has(ch)) continue;
      expect(handlers.has(ch), `allowlisted '${ch}' has no ipcMain.handle`).toBe(true);
    }
  });

  it('every handler is reachable (allowlisted, external, or a dedicated bridge)', () => {
    // Catches a new handler someone forgot to expose: renderer can never call it.
    for (const ch of handlers) {
      const reachable = invokeSet.has(ch) || bridge.has(ch);
      expect(reachable, `handler '${ch}' is not in INVOKE_CHANNELS or BRIDGE_ONLY_CHANNELS`).toBe(true);
    }
  });

  it("does not carry the dead 'invoke-channel' placeholder", () => {
    expect(invokeSet.has('invoke-channel')).toBe(false);
  });

  it('preload derives its allowlist from this module (no hand-copied literal list)', () => {
    const preload = readFileSync(join(__dirname, 'preload.js'), 'utf8');
    expect(preload).toMatch(/INVOKE_CHANNELS/);
    // The old 30-entry inline array must be gone.
    expect(preload).not.toMatch(/const validChannels = \[\s*'invoke-channel'/);
  });
});
