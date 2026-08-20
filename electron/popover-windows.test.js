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
  const wcListeners = new Map();
  const win = {
    destroyed: false,
    // Popover windows are created hidden and shown on demand, so `visible`
    // starts false and tracks show/hide — raiseVisiblePopovers() filters on it.
    visible: false,
    show: vi.fn(() => { win.visible = true; }),
    hide: vi.fn(() => { win.visible = false; }),
    setAlwaysOnTop: vi.fn(),
    isVisible: () => win.visible,
    isDestroyed: () => win.destroyed,
    on: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    emit: (event) => { for (const fn of listeners.get(event) ?? []) fn(); },
    webContents: {
      on: (event, fn) => {
        if (!wcListeners.has(event)) wcListeners.set(event, []);
        wcListeners.get(event).push(fn);
      },
    },
    // test helper: fire a navigation attempt, return whether it was blocked
    __navigate: (event, url) => {
      const e = { preventDefault: vi.fn(), url };
      for (const fn of wcListeners.get(event) ?? []) fn(e, url);
      return e.preventDefault.mock.calls.length > 0;
    },
    __hasNavListeners: () => wcListeners.has('will-navigate') && wcListeners.has('will-redirect'),
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

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const setPlatform = (value) =>
  Object.defineProperty(process, 'platform', { value, configurable: true });

describe('popover child-window visibility bridge', () => {
  let main;
  let setupPopoverWindowHandlers;
  let raiseVisiblePopovers;

  const setVisible = (name, visible) =>
    ipcHandlers.get('popover-window:set-visible')({}, { name, visible });

  beforeEach(() => {
    // The z-order behavior below is platform-dependent; pin the platform so
    // the suite asserts the same thing wherever it runs.
    setPlatform('win32');
    ipcHandlers.clear();
    ({ setupPopoverWindowHandlers, raiseVisiblePopovers } = loadModule());
    main = makeFakeMainWindow();
    setupPopoverWindowHandlers(main);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
    delete nodeRequire.cache[electronPath];
    delete nodeRequire.cache[modulePath];
  });

  it('creates popover windows hidden via the open handler override', () => {
    const decision = main.__open('sokuji-popover:1');
    expect(decision.action).toBe('allow');
    // show:false in the override is what prevents even a single visible
    // frame before the first explicit show.
    expect(decision.overrideBrowserWindowOptions).toMatchObject({ show: false });

    // The renderer opens with '' (Electron resolves it to about:blank).
    expect(main.__open('sokuji-popover:1', '').action).toBe('allow');
  });

  it('refuses a popover window asked to load a real URL', () => {
    // frameName is renderer-controlled, so the prefix alone must not be a
    // licence to load anything: a compromised renderer could otherwise get a
    // frameless, transparent, always-on-top window pointed at its own page.
    // Popover windows only ever host DOM portaled in from the parent.
    openExternal.mockClear();
    const decision = main.__open('sokuji-popover:1', 'https://evil.example/');
    expect(decision.action).toBe('deny');
    // Nor is it an external-link path — this shape is not a link click.
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('blocks navigation and redirects inside a popover window', () => {
    // setWindowOpenHandler only governs creation. Reusing an existing window
    // name navigates the live window instead, and any in-page navigation
    // would replace the popover with a web page in an always-on-top frame.
    const child = makeFakeChildWindow();
    main.__emitCreated(child, 'sokuji-popover:1');
    expect(child.__hasNavListeners()).toBe(true);

    expect(child.__navigate('will-navigate', 'https://evil.example/')).toBe(true);
    expect(child.__navigate('will-redirect', 'https://evil.example/')).toBe(true);
    // The document's own blank URL must not be blocked.
    expect(child.__navigate('will-navigate', 'about:blank')).toBe(false);
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

  it('pins the popover at the shared topmost level before showing it', () => {
    // The renderer can only ask for alwaysOnTop=true in its window.open
    // feature string, which lands the window on Electron's DEFAULT level,
    // 'floating'. On Windows that level is demoted below the taskbar inside
    // the topmost band while the pinned bar sits at the top of it, so the bar
    // covers its own settings popover — and the native tooltips that hang off
    // it — no matter which window was raised last. The override has to happen
    // here, in the main process, on every show.
    const child = makeFakeChildWindow();
    main.__emitCreated(child, 'sokuji-popover:1');

    setVisible('sokuji-popover:1', true);
    expect(child.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
    // Raised while still hidden: showing first would paint at least one frame
    // at the wrong z-order.
    expect(child.setAlwaysOnTop.mock.invocationCallOrder[0])
      .toBeLessThan(child.show.mock.invocationCallOrder[0]);

    // Re-raised on every show, not just the first: the bar's pin heartbeat
    // moves itself back to the top of the band between opens.
    setVisible('sokuji-popover:1', false);
    setVisible('sokuji-popover:1', true);
    expect(child.setAlwaysOnTop).toHaveBeenCalledTimes(2);
  });

  it('pins at the platform level, leaving macOS and Linux on floating', () => {
    // The bug is Windows-only. Everywhere else the shared level is exactly
    // what alwaysOnTop=true already produced, so this override is a no-op in
    // effect — worth asserting, because that is what makes the fix safe to
    // ship unconditionally.
    setPlatform('darwin');
    const child = makeFakeChildWindow();
    main.__emitCreated(child, 'sokuji-popover:1');
    setVisible('sokuji-popover:1', true);
    expect(child.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating');
  });

  it('re-raises only the popovers that are on screen', () => {
    // Called right after the bar re-asserts its own topmost position. A
    // hidden window must not be raised (nothing to fix, and it would churn
    // the z-order of a window the user cannot see), and a destroyed one must
    // not throw — the bar's heartbeat would die with it.
    const shown = makeFakeChildWindow();
    const hidden = makeFakeChildWindow();
    const dead = makeFakeChildWindow();
    main.__emitCreated(shown, 'sokuji-popover:1');
    main.__emitCreated(hidden, 'sokuji-popover:2');
    main.__emitCreated(dead, 'sokuji-popover:3');

    setVisible('sokuji-popover:1', true);
    setVisible('sokuji-popover:3', true);
    dead.destroyed = true;
    shown.setAlwaysOnTop.mockClear();

    expect(() => raiseVisiblePopovers()).not.toThrow();
    expect(shown.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
    expect(hidden.setAlwaysOnTop).not.toHaveBeenCalled();
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
