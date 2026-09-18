// electron/closeHandshake.wiring.test.js
//
// main.js and preload.js cannot be booted in vitest; their wiring of the close
// handshake is asserted on their source text, like ipc-channels.test.js does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const main = readFileSync(join(__dirname, 'main.js'), 'utf8');
const preload = readFileSync(join(__dirname, 'preload.js'), 'utf8');

describe('close handshake wiring', () => {
  it('holds the main window close', () => {
    expect(main).toMatch(/mainWindow\.on\('close',\s*\(event\)\s*=>\s*closeHandshake\.onWindowClose\(event\)\)/);
    expect(main).toMatch(/closeHandshake\.attachWindow\(mainWindow\)/);
  });

  it('runs quit cleanup only once the handshake lets the quit through', () => {
    expect(main).toMatch(/if \(!closeHandshake\.onBeforeQuit\(event\)\) return;\s*cleanupAndExit\(\);/);
    // A bare registration would run cleanup while the quit is held.
    expect(main).not.toMatch(/app\.on\('before-quit',\s*cleanupAndExit\)/);
  });

  it("answers the renderer's app:close-ready", () => {
    expect(main).toMatch(/ipcMain\.handle\('app:close-ready'/);
  });

  it('lets the renderer hear app:close-requested', () => {
    const list = preload.match(/const validReceiveChannels = \[([\s\S]*?)\];/);
    expect(list).not.toBeNull();
    expect(list[1]).toContain("'app:close-requested'");
  });
});
