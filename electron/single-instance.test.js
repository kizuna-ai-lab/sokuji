// electron/single-instance.test.js
//
// Sokuji was single-instance on macOS only, and only by accident: Launch
// Services refuses to start a second copy of the same .app bundle, so the app
// never needed a lock of its own. On Windows and Linux nothing plays that role
// -- every Start-menu click and every .desktop activation spawned a fully
// independent process that then fought the first one over system-global state
// (PulseAudio modules, the sidecar's file locks).
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { acquireSingleInstanceLock, focusWindow, createFocusRelay } = nodeRequire('./single-instance.js');

/** Minimal stand-in for Electron's `app`, recording what got registered. */
const fakeApp = (lockGranted, { packaged = false } = {}) => {
  const handlers = {};
  return {
    isPackaged: packaged,
    requestSingleInstanceLock: vi.fn(() => lockGranted),
    on: vi.fn((event, handler) => { handlers[event] = handler; }),
    handlers,
  };
};

describe('acquireSingleInstanceLock', () => {
  it('claims the lock and returns true for the first instance', () => {
    const app = fakeApp(true);
    expect(acquireSingleInstanceLock(app, { env: {} })).toBe(true);
    expect(app.requestSingleInstanceLock).toHaveBeenCalledOnce();
  });

  it('returns false for a duplicate launch', () => {
    const app = fakeApp(false);
    expect(acquireSingleInstanceLock(app, { env: {} })).toBe(false);
  });

  it('routes second-instance launches to the existing window', () => {
    const app = fakeApp(true);
    const onSecondInstance = vi.fn();
    acquireSingleInstanceLock(app, { env: {}, onSecondInstance });

    expect(app.on).toHaveBeenCalledWith('second-instance', expect.any(Function));
    app.handlers['second-instance']();
    expect(onSecondInstance).toHaveBeenCalledOnce();
  });

  it('does not register second-instance on the loser, whose event loop is about to die', () => {
    const app = fakeApp(false);
    acquireSingleInstanceLock(app, { env: {}, onSecondInstance: vi.fn() });
    expect(app.on).not.toHaveBeenCalled();
  });

  it('opts out entirely when SOKUJI_ALLOW_MULTIPLE_INSTANCES is set', () => {
    // The dev build and the installed build share one userData directory
    // (app.setName('sokuji') in both), so they would otherwise share one lock
    // and `npm run electron:dev` would exit instantly while Sokuji is running.
    const app = fakeApp(false, { packaged: false });
    expect(
      acquireSingleInstanceLock(app, { env: { SOKUJI_ALLOW_MULTIPLE_INSTANCES: '1' } })
    ).toBe(true);
    expect(app.requestSingleInstanceLock).not.toHaveBeenCalled();
  });

  it('ignores the opt-out in a packaged build, where two instances only break each other', () => {
    // A packaged Sokuji that inherits the variable -- from a shell profile, a
    // hand-edited .desktop Exec line -- would resurrect exactly the bug this
    // lock exists to fix: two processes fighting over the same PulseAudio
    // modules, either one's exit unloading the other's devices.
    const app = fakeApp(false, { packaged: true });
    expect(
      acquireSingleInstanceLock(app, { env: { SOKUJI_ALLOW_MULTIPLE_INSTANCES: '1' } })
    ).toBe(false);
    expect(app.requestSingleInstanceLock).toHaveBeenCalledOnce();
  });

  it('ignores an empty or unset opt-out value rather than treating it as truthy', () => {
    const app = fakeApp(true);
    acquireSingleInstanceLock(app, { env: { SOKUJI_ALLOW_MULTIPLE_INSTANCES: '' } });
    expect(app.requestSingleInstanceLock).toHaveBeenCalledOnce();
  });
});

describe('focusWindow', () => {
  const fakeWindow = (state = {}) => ({
    isDestroyed: () => state.destroyed ?? false,
    isMinimized: () => state.minimized ?? false,
    isVisible: () => state.visible ?? true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  });

  it('un-minimizes before focusing, since focus() alone leaves it in the taskbar', () => {
    const win = fakeWindow({ minimized: true });
    focusWindow(win);
    expect(win.restore).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledOnce();
  });

  it('shows a hidden window instead of only raising it', () => {
    const win = fakeWindow({ visible: false });
    focusWindow(win);
    expect(win.show).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledOnce();
  });

  it('only focuses a window that is already up', () => {
    const win = fakeWindow();
    focusWindow(win);
    expect(win.restore).not.toHaveBeenCalled();
    expect(win.show).not.toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalledOnce();
  });

  it('tolerates no window at all, the gap between quit and the next launch', () => {
    expect(() => focusWindow(null)).not.toThrow();
    expect(() => focusWindow(undefined)).not.toThrow();
  });

  it('tolerates a destroyed window, whose methods would throw', () => {
    const win = fakeWindow({ destroyed: true });
    focusWindow(win);
    expect(win.focus).not.toHaveBeenCalled();
  });
});

describe('createFocusRelay', () => {
  // The lock is claimed at module load, but mainWindow is only assigned deep
  // inside whenReady -- after Better Auth init, orphan-device cleanup and the
  // pactl round-trip that creates the virtual devices. Measured on Linux that
  // gap is ~530ms, and a duplicate launch fired 200-500ms after the first
  // reproducibly lands inside it. Handing focusWindow an undefined window
  // there drops the request silently, which is the one case the user is most
  // likely to produce: clicking the icon again because nothing appeared yet.
  const fakeWindow = () => ({
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  });

  it('focuses straight away once the window is up', () => {
    const win = fakeWindow();
    const relay = createFocusRelay(() => win);
    relay.onSecondInstance();
    expect(win.focus).toHaveBeenCalledOnce();
  });

  it('holds a request that arrives before the window exists, then honours it', () => {
    let win = null;
    const relay = createFocusRelay(() => win);
    relay.onSecondInstance();

    win = fakeWindow();
    relay.windowCreated();
    expect(win.focus).toHaveBeenCalledOnce();
  });

  it('collapses several early requests into one focus', () => {
    let win = null;
    const relay = createFocusRelay(() => win);
    relay.onSecondInstance();
    relay.onSecondInstance();
    relay.onSecondInstance();

    win = fakeWindow();
    relay.windowCreated();
    expect(win.focus).toHaveBeenCalledOnce();
  });

  it('does not raise the window on an ordinary first launch', () => {
    const win = fakeWindow();
    const relay = createFocusRelay(() => win);
    relay.windowCreated();
    expect(win.focus).not.toHaveBeenCalled();
  });

  it('clears the request once honoured, so a later window is not raised again', () => {
    let win = null;
    const relay = createFocusRelay(() => win);
    relay.onSecondInstance();

    win = fakeWindow();
    relay.windowCreated();

    const replacement = fakeWindow();
    win = replacement;
    relay.windowCreated();
    expect(replacement.focus).not.toHaveBeenCalled();
  });

  it('survives a window that never arrives', () => {
    const relay = createFocusRelay(() => null);
    relay.onSecondInstance();
    expect(() => relay.windowCreated()).not.toThrow();
  });
});
