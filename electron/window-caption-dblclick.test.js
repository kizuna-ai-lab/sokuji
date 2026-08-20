// electron/window-caption-dblclick.test.js
//
// Windows-only regression from #225: the main window became `frame: false` +
// `transparent: true`, and Electron forces `thick_frame_ = false` for
// transparent windows, which strips WS_CAPTION | WS_THICKFRAME from the
// window style. DefWindowProc then stops treating a double-click on an
// HTCAPTION area as a title-bar double-click, so the custom title bar (and
// the subtitle bar, which is the same BrowserWindow) lost double-click to
// maximize. Linux gets the behaviour from the window manager and macOS from
// AppKit's NSThemeFrame mouseDown, so only Windows needs this hook.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupCaptionDoubleClick,
  WM_NCLBUTTONDBLCLK,
  HTCAPTION,
} from './window-caption-dblclick.js';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
function setPlatform(value) {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

function makeFakeWindow({ maximized = false } = {}) {
  const win = {
    hooks: new Map(),
    maximized,
    destroyed: false,
    hookWindowMessage: vi.fn((message, callback) => win.hooks.set(message, callback)),
    isDestroyed: () => win.destroyed,
    isMaximized: () => win.maximized,
    maximize: vi.fn(() => { win.maximized = true; }),
    unmaximize: vi.fn(() => { win.maximized = false; }),
  };
  return win;
}

// Electron hands the WndProc's WPARAM to the hook as a pointer-sized Buffer.
function wParamBuffer(hitTest) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(hitTest));
  return buf;
}

function sendDoubleClick(win, wParam = wParamBuffer(HTCAPTION)) {
  const callback = win.hooks.get(WM_NCLBUTTONDBLCLK);
  if (!callback) throw new Error('no WM_NCLBUTTONDBLCLK hook installed');
  callback(wParam, Buffer.alloc(8));
}

beforeEach(() => setPlatform('win32'));
afterEach(() => Object.defineProperty(process, 'platform', originalPlatform));

describe('setupCaptionDoubleClick', () => {
  it('hooks WM_NCLBUTTONDBLCLK on Windows', () => {
    const win = makeFakeWindow();

    expect(setupCaptionDoubleClick(win)).toBe(true);
    expect(win.hookWindowMessage).toHaveBeenCalledTimes(1);
    expect(win.hookWindowMessage.mock.calls[0][0]).toBe(0x00a3);
  });

  it('installs no hook on Linux, where the window manager already maximizes', () => {
    setPlatform('linux');
    const win = makeFakeWindow();

    expect(setupCaptionDoubleClick(win)).toBe(false);
    expect(win.hookWindowMessage).not.toHaveBeenCalled();
  });

  it('installs no hook on macOS, where AppKit already zooms', () => {
    setPlatform('darwin');
    const win = makeFakeWindow();

    expect(setupCaptionDoubleClick(win)).toBe(false);
    expect(win.hookWindowMessage).not.toHaveBeenCalled();
  });

  it('maximizes a restored window on a caption double-click', () => {
    const win = makeFakeWindow({ maximized: false });
    setupCaptionDoubleClick(win);

    sendDoubleClick(win);

    expect(win.maximize).toHaveBeenCalledTimes(1);
    expect(win.unmaximize).not.toHaveBeenCalled();
  });

  it('unmaximizes a maximized window on a caption double-click', () => {
    const win = makeFakeWindow({ maximized: true });
    setupCaptionDoubleClick(win);

    sendDoubleClick(win);

    expect(win.unmaximize).toHaveBeenCalledTimes(1);
    expect(win.maximize).not.toHaveBeenCalled();
  });

  it('ignores a double-click on a resize border', () => {
    const win = makeFakeWindow();
    setupCaptionDoubleClick(win);

    const HTBOTTOMRIGHT = 17;
    sendDoubleClick(win, wParamBuffer(HTBOTTOMRIGHT));

    expect(win.maximize).not.toHaveBeenCalled();
    expect(win.unmaximize).not.toHaveBeenCalled();
  });

  it('accepts a numeric wParam, in case Electron stops boxing it in a Buffer', () => {
    const win = makeFakeWindow();
    setupCaptionDoubleClick(win);

    sendDoubleClick(win, HTCAPTION);

    expect(win.maximize).toHaveBeenCalledTimes(1);
  });

  it('acts on an unrecognized wParam shape rather than silently doing nothing', () => {
    // The hit-test filter only exists to skip resize-border double-clicks. If
    // a future Electron passes a shape we cannot decode, fail open: on a
    // frameless window WM_NCLBUTTONDBLCLK is almost always the drag region,
    // so acting keeps the feature alive where ignoring would kill it silently.
    const win = makeFakeWindow();
    setupCaptionDoubleClick(win);

    sendDoubleClick(win, { unexpected: 'shape' });

    expect(win.maximize).toHaveBeenCalledTimes(1);
  });

  it('ignores the message once the window is destroyed', () => {
    const win = makeFakeWindow();
    setupCaptionDoubleClick(win);
    win.destroyed = true;

    sendDoubleClick(win);

    expect(win.maximize).not.toHaveBeenCalled();
  });
});
