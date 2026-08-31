// electron/window-caption-menu.test.js
//
// Linux-only: right-clicking the custom title bar (a `-webkit-app-region:
// drag` area of the frameless main window) makes Chromium forward a
// _GTK_SHOW_WINDOW_MENU request to the window manager. Under GNOME on X11
// picking "Take Screenshot" from that menu leaves mutter's synchronous
// passive button grab frozen (XIAllowEvents is never called), freezing input
// for the whole session — measured on GNOME Shell 46.0 / mutter 46.2,
// Ubuntu 24.04, 2026-09-01. Chromium the browser is immune because its own
// caption right-click never reaches the WM: it shows a browser-drawn menu.
// This module does the same via Electron's `system-context-menu` event.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupCaptionContextMenu,
  captionMenuTemplate,
} from './window-caption-menu.js';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
function setPlatform(value) {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

function makeFakeWindow({ maximized = false, minimizable = true, maximizable = true } = {}) {
  const win = {
    listeners: new Map(),
    maximized,
    destroyed: false,
    on: vi.fn((event, callback) => win.listeners.set(event, callback)),
    isDestroyed: () => win.destroyed,
    isMaximized: () => win.maximized,
    isMinimizable: () => minimizable,
    isMaximizable: () => maximizable,
    minimize: vi.fn(),
    maximize: vi.fn(() => { win.maximized = true; }),
    unmaximize: vi.fn(() => { win.maximized = false; }),
    close: vi.fn(),
  };
  return win;
}

function makeFakeMenuApi() {
  const api = {
    popups: [],
    templates: [],
    buildFromTemplate: vi.fn((template) => {
      api.templates.push(template);
      const menu = { popup: vi.fn((options) => api.popups.push(options)) };
      return menu;
    }),
  };
  return api;
}

function rightClickCaption(win) {
  const callback = win.listeners.get('system-context-menu');
  if (!callback) throw new Error('no system-context-menu listener installed');
  const event = { preventDefault: vi.fn() };
  callback(event, { x: 0, y: 0 });
  return event;
}

// The replacement menu pops up on the next tick: a synchronous popup() from
// inside the event shows nothing on Linux (measured on Electron 40.8.5).
const tick = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => setPlatform('linux'));
afterEach(() => Object.defineProperty(process, 'platform', originalPlatform));

describe('setupCaptionContextMenu', () => {
  it('listens for system-context-menu on Linux', () => {
    const win = makeFakeWindow();

    expect(setupCaptionContextMenu(win, { menuApi: makeFakeMenuApi() })).toBe(true);
    expect(win.on).toHaveBeenCalledTimes(1);
    expect(win.on.mock.calls[0][0]).toBe('system-context-menu');
  });

  it('installs nothing on Windows, whose native system menu works fine', () => {
    setPlatform('win32');
    const win = makeFakeWindow();

    expect(setupCaptionContextMenu(win, { menuApi: makeFakeMenuApi() })).toBe(false);
    expect(win.on).not.toHaveBeenCalled();
  });

  it('installs nothing on macOS, where the event never fires anyway', () => {
    setPlatform('darwin');
    const win = makeFakeWindow();

    expect(setupCaptionContextMenu(win, { menuApi: makeFakeMenuApi() })).toBe(false);
    expect(win.on).not.toHaveBeenCalled();
  });

  it('suppresses the system window menu', () => {
    const win = makeFakeWindow();
    setupCaptionContextMenu(win, { menuApi: makeFakeMenuApi() });

    const event = rightClickCaption(win);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('pops up a replacement menu on the window', async () => {
    const win = makeFakeWindow();
    const menuApi = makeFakeMenuApi();
    setupCaptionContextMenu(win, { menuApi });

    rightClickCaption(win);
    await tick();

    expect(menuApi.buildFromTemplate).toHaveBeenCalledTimes(1);
    expect(menuApi.popups).toEqual([{ window: win }]);
  });

  it('suppresses synchronously, before the deferred popup', () => {
    // preventDefault must not wait for the tick: once the handler returns,
    // Electron decides whether the system menu goes through.
    const win = makeFakeWindow();
    const menuApi = makeFakeMenuApi();
    setupCaptionContextMenu(win, { menuApi });

    const event = rightClickCaption(win);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('still suppresses, but shows no menu, once the window is destroyed', async () => {
    // Covers destruction before the click and in the gap before the tick.
    const win = makeFakeWindow();
    const menuApi = makeFakeMenuApi();
    setupCaptionContextMenu(win, { menuApi });
    win.destroyed = true;

    const event = rightClickCaption(win);
    await tick();

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(menuApi.buildFromTemplate).not.toHaveBeenCalled();
  });
});

describe('captionMenuTemplate', () => {
  it('offers Minimize, Maximize and Close on an unmaximized window', () => {
    const win = makeFakeWindow({ maximized: false });

    const labels = captionMenuTemplate(win).map((item) => item.label ?? item.type);

    expect(labels).toEqual(['Minimize', 'Maximize', 'separator', 'Close']);
  });

  it('offers Restore instead of Maximize on a maximized window', () => {
    const win = makeFakeWindow({ maximized: true });

    const labels = captionMenuTemplate(win).map((item) => item.label ?? item.type);

    expect(labels).toEqual(['Minimize', 'Restore', 'separator', 'Close']);
  });

  it('disables Minimize and Maximize when the window forbids them', () => {
    const win = makeFakeWindow({ minimizable: false, maximizable: false });

    const [minimize, maximize] = captionMenuTemplate(win);

    expect(minimize.enabled).toBe(false);
    expect(maximize.enabled).toBe(false);
  });

  it('drives the window from each item', () => {
    const win = makeFakeWindow({ maximized: false });

    const [minimize, maximize, , close] = captionMenuTemplate(win);
    minimize.click();
    maximize.click();
    close.click();

    expect(win.minimize).toHaveBeenCalledTimes(1);
    expect(win.maximize).toHaveBeenCalledTimes(1);
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it('restores from the Restore item', () => {
    const win = makeFakeWindow({ maximized: true });

    const [, restore] = captionMenuTemplate(win);
    restore.click();

    expect(win.unmaximize).toHaveBeenCalledTimes(1);
  });

  it('ignores clicks that land after the window is destroyed', () => {
    // Menu items outlive the window: the popup stays open while the window
    // can be closed from elsewhere (tray, IPC), and the click arrives late.
    const win = makeFakeWindow({ maximized: false });

    const items = captionMenuTemplate(win);
    win.destroyed = true;
    for (const item of items) item.click?.();

    expect(win.minimize).not.toHaveBeenCalled();
    expect(win.maximize).not.toHaveBeenCalled();
    expect(win.close).not.toHaveBeenCalled();
  });
});
