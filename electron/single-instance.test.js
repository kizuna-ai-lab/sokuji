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
const { acquireSingleInstanceLock, focusWindow } = nodeRequire('./single-instance.js');

/** Minimal stand-in for Electron's `app`, recording what got registered. */
const fakeApp = (lockGranted) => {
  const handlers = {};
  return {
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
    const app = fakeApp(false);
    expect(
      acquireSingleInstanceLock(app, { env: { SOKUJI_ALLOW_MULTIPLE_INSTANCES: '1' } })
    ).toBe(true);
    expect(app.requestSingleInstanceLock).not.toHaveBeenCalled();
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
