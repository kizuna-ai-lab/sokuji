// electron/window-caption-dblclick.test.js
//
// Windows-only regression from #225: the main window became `frame: false` +
// `transparent: true`, and Chromium strips WS_CAPTION | WS_THICKFRAME from
// such a window. DefWindowProc then refuses to maximize it, so the custom
// title bar (and the subtitle bar, which is the same BrowserWindow) lost
// double-click to maximize. Linux gets the behaviour from the window manager
// and macOS from AppKit's NSThemeFrame mouseDown, so only Windows needs help.
//
// The message to hook is WM_SYSCOMMAND, not WM_NCLBUTTONDBLCLK. Measured on
// Electron 40 / Win 11, a title-bar double-click delivers exactly one message
// to the top-level HWND — WM_SYSCOMMAND with wParam 0xf032 (SC_MAXIMIZE plus
// the internal low bits) — and no WM_NCLBUTTONDBLCLK ever arrives, because the
// non-client mouse messages are consumed by the child HWND that hosts the web
// contents.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupCaptionDoubleClick,
  WM_SYSCOMMAND,
  SC_RESTORE,
} from './window-caption-dblclick.js';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
function setPlatform(value) {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

function makeFakeWindow({ maximized = false, minimized = false } = {}) {
  const win = {
    hooks: new Map(),
    maximized,
    minimized,
    destroyed: false,
    hookWindowMessage: vi.fn((message, callback) => win.hooks.set(message, callback)),
    isDestroyed: () => win.destroyed,
    isMaximized: () => win.maximized,
    isMinimized: () => win.minimized,
    maximize: vi.fn(() => { win.maximized = true; }),
    unmaximize: vi.fn(() => { win.maximized = false; }),
  };
  return win;
}

// Electron hands the WndProc's WPARAM to the hook as a pointer-sized Buffer.
function wParamBuffer(command) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(command));
  return buf;
}

/** The exact wParam a caption double-click produces on Win 11 / Electron 40. */
const OBSERVED_DBLCLK_WPARAM = 0xf032;

function sendSysCommand(win, wParam) {
  const callback = win.hooks.get(WM_SYSCOMMAND);
  if (!callback) throw new Error('no WM_SYSCOMMAND hook installed');
  callback(wParam, Buffer.alloc(8));
}

beforeEach(() => setPlatform('win32'));
afterEach(() => Object.defineProperty(process, 'platform', originalPlatform));

describe('setupCaptionDoubleClick', () => {
  it('hooks WM_SYSCOMMAND on Windows', () => {
    const win = makeFakeWindow();

    expect(setupCaptionDoubleClick(win)).toBe(true);
    expect(win.hookWindowMessage).toHaveBeenCalledTimes(1);
    expect(win.hookWindowMessage.mock.calls[0][0]).toBe(0x0112);
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

  it('maximizes on the wParam a real caption double-click delivers', () => {
    // 0xf032, not a clean SC_MAXIMIZE: the low four bits are reserved for
    // Windows' internal use and must be masked off before comparing.
    const win = makeFakeWindow({ maximized: false });
    setupCaptionDoubleClick(win);

    sendSysCommand(win, wParamBuffer(OBSERVED_DBLCLK_WPARAM));

    expect(win.maximize).toHaveBeenCalledTimes(1);
    expect(win.unmaximize).not.toHaveBeenCalled();
  });

  it('restores a maximized window on SC_RESTORE', () => {
    const win = makeFakeWindow({ maximized: true });
    setupCaptionDoubleClick(win);

    sendSysCommand(win, wParamBuffer(SC_RESTORE | 0x2));

    expect(win.unmaximize).toHaveBeenCalledTimes(1);
    expect(win.maximize).not.toHaveBeenCalled();
  });

  it('leaves a minimized window alone on SC_RESTORE', () => {
    // Un-minimizing from the taskbar also sends SC_RESTORE. Un-maximizing there
    // would discard the maximized state the user is returning to.
    const win = makeFakeWindow({ maximized: true, minimized: true });
    setupCaptionDoubleClick(win);

    sendSysCommand(win, wParamBuffer(SC_RESTORE));

    expect(win.unmaximize).not.toHaveBeenCalled();
  });

  it('restores on a second double-click, which reports SC_MAXIMIZE again', () => {
    // Measured: both clicks of a maximize/restore pair arrive as 0xf032. The
    // child HWND doing the translation is not itself maximized, so it never
    // reports SC_RESTORE. Treating SC_MAXIMIZE literally strands the window
    // maximized -- this is the regression that shipped in the first fix.
    const win = makeFakeWindow({ maximized: false });
    setupCaptionDoubleClick(win);

    sendSysCommand(win, wParamBuffer(OBSERVED_DBLCLK_WPARAM));
    expect(win.maximize).toHaveBeenCalledTimes(1);
    expect(win.isMaximized()).toBe(true);

    sendSysCommand(win, wParamBuffer(OBSERVED_DBLCLK_WPARAM));
    expect(win.unmaximize).toHaveBeenCalledTimes(1);
    expect(win.isMaximized()).toBe(false);
  });

  it.each([
    ['SC_CLOSE', 0xf060],
    ['SC_MINIMIZE', 0xf020],
    ['SC_MOVE', 0xf010],
    ['SC_SIZE', 0xf000],
    ['SC_KEYMENU', 0xf100],
  ])('ignores %s, which shares WM_SYSCOMMAND', (_name, command) => {
    const win = makeFakeWindow();
    setupCaptionDoubleClick(win);

    sendSysCommand(win, wParamBuffer(command));

    expect(win.maximize).not.toHaveBeenCalled();
    expect(win.unmaximize).not.toHaveBeenCalled();
  });

  it('accepts a numeric wParam, in case Electron stops boxing it in a Buffer', () => {
    const win = makeFakeWindow();
    setupCaptionDoubleClick(win);

    sendSysCommand(win, OBSERVED_DBLCLK_WPARAM);

    expect(win.maximize).toHaveBeenCalledTimes(1);
  });

  it('fails closed on an unrecognized wParam shape', () => {
    // The opposite of a hit-test filter: WM_SYSCOMMAND also carries SC_CLOSE
    // and SC_MINIMIZE, so guessing would maximize on an unrelated command.
    const win = makeFakeWindow();
    setupCaptionDoubleClick(win);

    sendSysCommand(win, { unexpected: 'shape' });

    expect(win.maximize).not.toHaveBeenCalled();
    expect(win.unmaximize).not.toHaveBeenCalled();
  });

  it('ignores the message once the window is destroyed', () => {
    const win = makeFakeWindow();
    setupCaptionDoubleClick(win);
    win.destroyed = true;

    sendSysCommand(win, wParamBuffer(OBSERVED_DBLCLK_WPARAM));

    expect(win.maximize).not.toHaveBeenCalled();
  });
});
