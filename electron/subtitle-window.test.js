// electron/subtitle-window.test.js
//
// Main-process tests for the subtitle window IPC handlers, focused on the
// always-on-top enforcement added for issue #326: on Windows, PowerPoint's
// slideshow / Presenter View re-asserts its own topmost z-order whenever
// window activation changes, so a one-shot setAlwaysOnTop() call gets
// displaced permanently (e.g., as soon as the user merely clicks the pinned
// subtitle bar). Crucially, the displaced window KEEPS its WS_EX_TOPMOST
// style — isAlwaysOnTop() still returns true — so the only reliable fix is
// to unconditionally re-assert the topmost position while pinned.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';

// subtitle-window.js is a CommonJS main-process file whose require('electron')
// is left as a native Node require by vite-node (the real build externalizes
// 'electron' the same way), so vi.mock('electron') cannot intercept it.
// Instead, load the module with Node's own require and pre-seed the module
// cache with a fake 'electron' — production code stays untouched.
const nodeRequire = createRequire(import.meta.url);
const electronPath = nodeRequire.resolve('electron');
const modulePath = nodeRequire.resolve('./subtitle-window.js');

const ipcHandlers = new Map();
const fakeElectron = {
  ipcMain: {
    handle: (channel, fn) => ipcHandlers.set(channel, fn),
  },
  screen: {
    getPrimaryDisplay: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    }),
  },
};

function loadSubtitleWindowModule() {
  nodeRequire.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: fakeElectron,
  };
  delete nodeRequire.cache[modulePath]; // fresh module state per test
  return nodeRequire(modulePath);
}

function makeFakeWindow() {
  const listeners = new Map();
  const win = {
    destroyed: false,
    visible: true,
    minimized: false,
    setBounds: vi.fn(),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1200, height: 800 })),
    setAlwaysOnTop: vi.fn(),
    moveTop: vi.fn(),
    setResizable: vi.fn(),
    setWindowButtonVisibility: vi.fn(),
    isFullScreen: () => false,
    setFullScreen: vi.fn(),
    isVisible: () => win.visible,
    isMinimized: () => win.minimized,
    isDestroyed: () => win.destroyed,
    webContents: { send: vi.fn() },
    on: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    emit: (event) => {
      for (const fn of listeners.get(event) ?? []) fn();
    },
  };
  return win;
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const setPlatform = (value) =>
  Object.defineProperty(process, 'platform', { value, configurable: true });

describe('subtitle-window always-on-top enforcement (#326)', () => {
  let win;
  let setupSubtitleHandlers;

  const enter = (payload) => ipcHandlers.get('subtitle:enter')({}, payload);
  const exit = (payload = {}) => ipcHandlers.get('subtitle:exit')({}, payload);
  const setAot = (flag) => ipcHandlers.get('subtitle:set-always-on-top')({}, flag);

  beforeEach(() => {
    vi.useFakeTimers();
    setPlatform('win32');
    ipcHandlers.clear();
    ({ setupSubtitleHandlers } = loadSubtitleWindowModule());
    win = makeFakeWindow();
    setupSubtitleHandlers(win);
  });

  afterEach(() => {
    // Tear down the window so no enforcement timers leak between tests.
    win.destroyed = true;
    win.emit('closed');
    vi.clearAllTimers();
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', originalPlatform);
    delete nodeRequire.cache[electronPath];
    delete nodeRequire.cache[modulePath];
  });

  it('pins with the screen-saver level on Windows so the bar is not re-inserted below the taskbar', async () => {
    // Electron's 'floating' level (the macOS default here) makes every
    // setAlwaysOnTop call on Windows end with a second SetWindowPos that
    // tucks the window just below Shell_TrayWnd — below a PowerPoint
    // slideshow, which sits above the taskbar in the topmost band.
    await enter({ alwaysOnTop: true });
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
  });

  it('keeps the floating level on macOS', async () => {
    setPlatform('darwin');
    await enter({ alwaysOnTop: true });
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating');
  });

  it('periodically re-asserts topmost while pinned in subtitle mode', async () => {
    await enter({ alwaysOnTop: true });
    win.setAlwaysOnTop.mockClear();

    vi.advanceTimersByTime(3000);

    // The re-assert must be unconditional: when PowerPoint stacks itself
    // above us the WS_EX_TOPMOST style is intact (isAlwaysOnTop() === true),
    // so any "already on top" guard would skip exactly the case that matters.
    // Exactly one call per 1s tick — a duplicate (stacked) interval would
    // produce more.
    expect(win.setAlwaysOnTop.mock.calls).toEqual([
      [true, 'screen-saver'],
      [true, 'screen-saver'],
      [true, 'screen-saver'],
    ]);
    // Never a false→true toggle: setAlwaysOnTop(false) drops the bar out of
    // the topmost band each tick and can knock OTHER topmost windows down
    // (electron/electron#31536). The toEqual above pins this (no [false]
    // call), as does the focus/blur assertion below.
    // moveTop() must NOT be used either: its SWP_SHOWWINDOW flag force-shows
    // a hidden window, and HWND_TOP escalates the z-order arms race.
    expect(win.moveTop).not.toHaveBeenCalled();
  });

  it('does not enforce when subtitle mode is entered without alwaysOnTop', async () => {
    await enter({ alwaysOnTop: false });
    win.setAlwaysOnTop.mockClear();

    vi.advanceTimersByTime(5000);

    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it('stops enforcement on subtitle:exit', async () => {
    await enter({ alwaysOnTop: true });
    await exit();
    win.setAlwaysOnTop.mockClear();

    vi.advanceTimersByTime(5000);

    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it('stops enforcement when the pin is toggled off, restarts when toggled on', async () => {
    await enter({ alwaysOnTop: true });

    await setAot(false);
    win.setAlwaysOnTop.mockClear();
    vi.advanceTimersByTime(5000);
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();

    await setAot(true);
    win.setAlwaysOnTop.mockClear();
    vi.advanceTimersByTime(3000);
    expect(win.setAlwaysOnTop.mock.calls.length).toBe(3);
  });

  it('re-asserts promptly after the window is clicked (focus), without waiting for the heartbeat', async () => {
    // Clicking the pinned bar activates it; PowerPoint reacts to losing
    // activation by re-raising the slideshow above us a few ms later. A
    // short delayed re-assert must win that race well before the 1s
    // heartbeat.
    await enter({ alwaysOnTop: true });
    win.setAlwaysOnTop.mockClear();

    win.emit('focus');
    vi.advanceTimersByTime(500);

    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
    // Single-call re-assert only — never a false→true toggle.
    expect(win.setAlwaysOnTop.mock.calls.every(([flag]) => flag === true)).toBe(true);
  });

  it('re-asserts promptly after the window loses focus (blur)', async () => {
    await enter({ alwaysOnTop: true });
    win.setAlwaysOnTop.mockClear();

    win.emit('blur');
    vi.advanceTimersByTime(500);

    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
    expect(win.setAlwaysOnTop.mock.calls.every(([flag]) => flag === true)).toBe(true);
  });

  it('cancels a pending focus/blur re-assert when the pin is turned off', async () => {
    // Click the bar (schedules the 200ms re-assert), then unpin before it
    // fires: the stale timer must not re-pin an unpinned window.
    await enter({ alwaysOnTop: true });
    win.emit('focus');

    await setAot(false);
    win.setAlwaysOnTop.mockClear();
    vi.advanceTimersByTime(500);

    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it('cancels a pending focus/blur re-assert on subtitle:exit', async () => {
    await enter({ alwaysOnTop: true });
    win.emit('focus');

    await exit();
    win.setAlwaysOnTop.mockClear();
    vi.advanceTimersByTime(500);

    // A stale re-assert here would silently re-pin the restored main window
    // at screen-saver level — stuck above every other app.
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it('does not stack heartbeats when subtitle:enter runs again without an exit', async () => {
    await enter({ alwaysOnTop: true });
    await enter({ alwaysOnTop: true });
    win.setAlwaysOnTop.mockClear();

    vi.advanceTimersByTime(3000);
    expect(win.setAlwaysOnTop.mock.calls.length).toBe(3);

    // And a single toggle-off silences everything — an orphaned duplicate
    // interval would keep firing.
    await setAot(false);
    win.setAlwaysOnTop.mockClear();
    vi.advanceTimersByTime(5000);
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it('stops enforcement when re-entering subtitle mode with the pin off', async () => {
    await enter({ alwaysOnTop: true });
    await enter({ alwaysOnTop: false });
    win.setAlwaysOnTop.mockClear();

    vi.advanceTimersByTime(5000);
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it('focus/blur do not re-assert when not pinned', async () => {
    await enter({ alwaysOnTop: false });
    win.setAlwaysOnTop.mockClear();

    win.emit('focus');
    win.emit('blur');
    vi.advanceTimersByTime(500);

    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it('skips re-asserting while the window is hidden or minimized', async () => {
    // main.js exposes a minimize control for the frameless window; z-order
    // churn on an invisible window is pointless and (with SWP_SHOWWINDOW
    // style calls) risks forcing it back on screen.
    await enter({ alwaysOnTop: true });
    win.setAlwaysOnTop.mockClear();

    win.minimized = true;
    vi.advanceTimersByTime(3000);
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();

    win.minimized = false;
    win.visible = false;
    vi.advanceTimersByTime(3000);
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();

    // Enforcement resumes (not stopped) once the window is visible again.
    win.visible = true;
    vi.advanceTimersByTime(3000);
    expect(win.setAlwaysOnTop.mock.calls.length).toBe(3);
  });

  it('stops enforcement and clears all timers when the window is closed', async () => {
    await enter({ alwaysOnTop: true });

    win.destroyed = true;
    win.emit('closed');
    win.setAlwaysOnTop.mockClear();

    vi.advanceTimersByTime(5000);

    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('survives the window being destroyed between heartbeats', async () => {
    await enter({ alwaysOnTop: true });

    win.destroyed = true; // destroyed without 'closed' having fired yet
    win.setAlwaysOnTop.mockClear();

    expect(() => vi.advanceTimersByTime(3000)).not.toThrow();
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it('does not run the enforcement heartbeat on non-Windows platforms', async () => {
    setPlatform('darwin');
    await enter({ alwaysOnTop: true });
    win.setAlwaysOnTop.mockClear();

    win.emit('focus');
    win.emit('blur');
    vi.advanceTimersByTime(5000);

    // macOS 'floating' level already keeps the window above fullscreen
    // presentations; keep the original one-shot behavior there.
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
  });
});
