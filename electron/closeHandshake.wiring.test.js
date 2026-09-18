// electron/closeHandshake.wiring.test.js
//
// main.js and preload.js cannot be booted in vitest; their wiring of the close
// handshake is asserted on their source text, like ipc-channels.test.js does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const main = readFileSync(join(__dirname, 'main.js'), 'utf8');
const preload = readFileSync(join(__dirname, 'preload.js'), 'utf8');
const updater = readFileSync(join(__dirname, 'update-manager.js'), 'utf8');

/** Index of `needle` in `text`; fails (rather than returning -1) when it is gone. */
function at(text, needle) {
  const i = text.indexOf(needle);
  expect(i, `expected to find ${needle}`).toBeGreaterThan(-1);
  return i;
}

/** The source of the `ipcMain.handle(channel, …)` registration in `text`. */
function handler(text, channel) {
  const start = at(text, `ipcMain.handle('${channel}'`);
  const rest = text.slice(start);
  return rest.slice(0, at(rest, '\n});') + 4);
}

const SENDER_CHECK = 'if (event.sender !== mainWindow?.webContents) return;';

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
    const body = handler(main, 'app:close-ready');
    expect(body).toContain('closeHandshake.ready()');
  });

  it("takes the renderer's app:session-busy as the hold condition", () => {
    const body = handler(main, 'app:session-busy');
    expect(body).toContain('closeHandshake.setSessionBusy(');
  });

  it("ignores both from anything but the main window's page (a popover child window)", () => {
    for (const [channel, call] of [
      ['app:close-ready', 'closeHandshake.ready()'],
      ['app:session-busy', 'closeHandshake.setSessionBusy('],
    ]) {
      const body = handler(main, channel);
      expect(at(body, SENDER_CHECK), channel).toBeLessThan(at(body, call));
    }
  });

  it('ends a running session before an update installs', () => {
    const rest = main.slice(at(main, 'new UpdateManager('));
    const call = rest.slice(0, at(rest, ');'));
    expect(call).toContain('beforeInstall:');
    expect(call).toContain('closeHandshake.endSessionThen(');
  });

  it('awaits beforeInstall ahead of both install paths', () => {
    const rest = updater.slice(at(updater, "ipcMain.handle('update-install'"));
    const body = rest.slice(0, at(rest, '\n    });'));
    const hook = at(body, 'await new Promise((resolve) => this.beforeInstall(resolve));');
    expect(hook).toBeLessThan(at(body, 'autoUpdater.quitAndInstall()'));
    expect(hook).toBeLessThan(at(body, 'this._installUpdate()'));
    expect(updater).toContain('this.beforeInstall = beforeInstall;');
  });

  it('lets the renderer hear app:close-requested', () => {
    const list = preload.match(/const validReceiveChannels = \[([\s\S]*?)\];/);
    expect(list).not.toBeNull();
    expect(list[1]).toContain("'app:close-requested'");
  });
});
