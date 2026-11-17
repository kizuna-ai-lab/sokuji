import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { windowStateOf, watchWindowState } from './window-state.js';

/** A BrowserWindow as far as these functions use it. */
function fakeWindow({ maximized = false, fullScreen = false } = {}) {
  const handlers = new Map();
  const win = {
    maximized,
    fullScreen,
    destroyed: false,
    isMaximized: () => win.maximized,
    isFullScreen: () => win.fullScreen,
    isDestroyed: () => win.destroyed,
    on: (name, fn) => handlers.set(name, fn),
    emit: (name) => handlers.get(name)?.(),
    webContents: { send: vi.fn() },
  };
  return win;
}

describe('the main window state the page draws its edge from', () => {
  it('says whether the window is maximized and whether it is full screen', () => {
    expect(windowStateOf(fakeWindow())).toEqual({ maximized: false, fullScreen: false });
    expect(windowStateOf(fakeWindow({ maximized: true }))).toEqual({ maximized: true, fullScreen: false });
    expect(windowStateOf(fakeWindow({ fullScreen: true }))).toEqual({ maximized: false, fullScreen: true });
  });

  it('tells the page each time the window is maximized, restored, or enters or leaves full screen', () => {
    const win = fakeWindow();
    watchWindowState(win);
    win.maximized = true;
    win.emit('maximize');
    win.maximized = false;
    win.emit('unmaximize');
    win.fullScreen = true;
    win.emit('enter-full-screen');
    win.fullScreen = false;
    win.emit('leave-full-screen');
    expect(win.webContents.send.mock.calls).toEqual([
      ['window:state', { maximized: true, fullScreen: false }],
      ['window:state', { maximized: false, fullScreen: false }],
      ['window:state', { maximized: false, fullScreen: true }],
      ['window:state', { maximized: false, fullScreen: false }],
    ]);
  });

  it('sends nothing once the window is gone', () => {
    const win = fakeWindow();
    watchWindowState(win);
    win.destroyed = true;
    win.emit('unmaximize');
    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});

describe('its wiring', () => {
  const main = readFileSync(join(__dirname, 'main.js'), 'utf8');
  const preload = readFileSync(join(__dirname, 'preload.js'), 'utf8');

  it('watches the main window and answers the page asking for the state now', () => {
    expect(main).toContain("const { windowStateOf, watchWindowState } = require('./window-state');");
    expect(main).toContain('watchWindowState(mainWindow);');
    expect(main).toContain("ipcMain.handle('window:get-state', () => (mainWindow ? windowStateOf(mainWindow) : null));");
  });

  it('lets the page hear window:state', () => {
    const list = preload.match(/const validReceiveChannels = \[([\s\S]*?)\];/);
    expect(list).not.toBeNull();
    expect(list[1]).toContain("'window:state'");
  });
});
