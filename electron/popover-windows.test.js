// electron/popover-windows.test.js
//
// Main-process tests for the popover child-window visibility bridge.
//
// The subtitle bar hosts its popovers in frameless child windows the renderer
// opens via window.open. They must be created HIDDEN and shown/hidden on
// demand: the renderer has no visibility API on a DOM Window, and parking
// windows off-screen does not work — mutter clamps both the initial position
// and runtime moveTo back onto the screen (measured: a window "parked" at
// (-10000, 0) sat at (0, 32), fully visible).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const electronPath = nodeRequire.resolve('electron');
const modulePath = nodeRequire.resolve('./popover-windows.js');

const ipcHandlers = new Map();
const openExternal = vi.fn();
const fakeElectron = {
  ipcMain: {
    handle: (channel, fn) => ipcHandlers.set(channel, fn),
  },
  shell: {
    openExternal: (...a) => openExternal(...a),
  },
};

function loadModule() {
  nodeRequire.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: fakeElectron,
  };
  delete nodeRequire.cache[modulePath];
  return nodeRequire(modulePath);
}

function makeFakeChildWindow() {
  const listeners = new Map();
  const win = {
    destroyed: false,
    show: vi.fn(),
    hide: vi.fn(),
    isDestroyed: () => win.destroyed,
    on: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    emit: (event) => { for (const fn of listeners.get(event) ?? []) fn(); },
  };
  return win;
}

function makeFakeMainWindow() {
  const wcListeners = new Map();
  let openHandler = null;
  const win = {
    destroyed: false,
    isDestroyed: () => win.destroyed,
    webContents: {
      setWindowOpenHandler: (fn) => { openHandler = fn; },
      on: (event, fn) => {
        if (!wcListeners.has(event)) wcListeners.set(event, []);
        wcListeners.get(event).push(fn);
      },
    },
    // test helpers
    __open: (frameName, url = 'about:blank') => openHandler({ frameName, url }),
    __emitCreated: (child, frameName) => {
      for (const fn of wcListeners.get('did-create-window') ?? []) fn(child, { frameName });
    },
  };
  return win;
}

describe('popover child-window visibility bridge', () => {
  let main;
  let setupPopoverWindowHandlers;

  const setVisible = (name, visible) =>
    ipcHandlers.get('popover-window:set-visible')({}, { name, visible });

  beforeEach(() => {
    ipcHandlers.clear();
    ({ setupPopoverWindowHandlers } = loadModule());
    main = makeFakeMainWindow();
    setupPopoverWindowHandlers(main);
  });

  afterEach(() => {
    delete nodeRequire.cache[electronPath];
    delete nodeRequire.cache[modulePath];
  });

  it('creates popover windows hidden via the open handler override', () => {
    const decision = main.__open('sokuji-popover:1');
    expect(decision.action).toBe('allow');
    // show:false in the override is what prevents even a single visible
    // frame before the first explicit show.
    expect(decision.overrideBrowserWindowOptions).toMatchObject({ show: false });
  });

  it('denies non-popover window.opens, routing http(s) URLs to the system browser', () => {
    // The app's own window.open('http…', '_blank') calls (help links, update
    // downloads) belong in the system browser, and a compromised renderer
    // must not be able to conjure arbitrary Electron windows.
    openExternal.mockClear();
    const web = main.__open('some-other-window', 'https://sokuji.kizuna.ai/docs');
    expect(web.action).toBe('deny');
    expect(openExternal).toHaveBeenCalledWith('https://sokuji.kizuna.ai/docs');

    openExternal.mockClear();
    const blank = main.__open('', 'about:blank');
    expect(blank.action).toBe('deny');
    expect(openExternal).not.toHaveBeenCalled();

    // Non-web schemes never reach the OS.
    openExternal.mockClear();
    const weird = main.__open('', 'file:///etc/passwd');
    expect(weird.action).toBe('deny');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('shows and hides a registered popover window on demand', () => {
    const child = makeFakeChildWindow();
    main.__emitCreated(child, 'sokuji-popover:1');

    expect(setVisible('sokuji-popover:1', true)).toMatchObject({ ok: true });
    expect(child.show).toHaveBeenCalledTimes(1);

    expect(setVisible('sokuji-popover:1', false)).toMatchObject({ ok: true });
    expect(child.hide).toHaveBeenCalledTimes(1);
  });

  it('reports ok:false for an unknown or closed window instead of throwing', () => {
    expect(setVisible('sokuji-popover:99', true)).toMatchObject({ ok: false });

    const child = makeFakeChildWindow();
    main.__emitCreated(child, 'sokuji-popover:2');
    child.emit('closed');
    expect(setVisible('sokuji-popover:2', true)).toMatchObject({ ok: false });

    const child2 = makeFakeChildWindow();
    main.__emitCreated(child2, 'sokuji-popover:3');
    child2.destroyed = true;
    expect(setVisible('sokuji-popover:3', true)).toMatchObject({ ok: false });
    expect(child2.show).not.toHaveBeenCalled();
  });

  it('ignores created windows without the popover prefix', () => {
    const child = makeFakeChildWindow();
    main.__emitCreated(child, 'unrelated');
    expect(setVisible('unrelated', true)).toMatchObject({ ok: false });
  });

  it('survives setup being called again for a recreated main window', () => {
    // ipcMain.handle throws on duplicate registration; handlers must be
    // registered at module load, not per setup call (the subtitle-window
    // module documents the same trap).
    const main2 = makeFakeMainWindow();
    expect(() => setupPopoverWindowHandlers(main2)).not.toThrow();

    const child = makeFakeChildWindow();
    main2.__emitCreated(child, 'sokuji-popover:9');
    expect(setVisible('sokuji-popover:9', true)).toMatchObject({ ok: true });
  });
});
