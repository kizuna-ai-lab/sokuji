// electron/close-handshake.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { createCloseHandshake, DEFAULT_TIMEOUT_MS } = nodeRequire('./close-handshake.js');

function fakeWindow() {
  const w = {
    destroyed: false,
    sent: [],
    close: vi.fn(),
    isDestroyed: () => w.destroyed,
    webContents: {
      destroyed: false,
      crashed: false,
      isDestroyed: () => w.webContents.destroyed,
      isCrashed: () => w.webContents.crashed,
      send: (channel) => w.sent.push(channel),
    },
  };
  return w;
}
const event = () => ({ preventDefault: vi.fn() });

let timer;
let quitApp;
let hs;
let win;
beforeEach(() => {
  timer = null;
  quitApp = vi.fn();
  hs = createCloseHandshake({
    quitApp,
    setTimer: (fn, ms) => { timer = { fn, ms }; return 1; },
    clearTimer: () => { timer = null; },
  });
  win = fakeWindow();
  hs.attachWindow(win);
});

describe('close handshake', () => {
  it('holds a close, asks the renderer, and closes once it answers', () => {
    const e = event();
    hs.onWindowClose(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(win.sent).toEqual(['app:close-requested']);
    expect(timer.ms).toBe(DEFAULT_TIMEOUT_MS);

    hs.ready();
    expect(win.close).toHaveBeenCalledTimes(1);
    expect(timer).toBeNull();

    const again = event();
    hs.onWindowClose(again); // the close() above re-enters 'close'
    expect(again.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores repeated close clicks while waiting', () => {
    hs.onWindowClose(event());
    const second = event();
    hs.onWindowClose(second);
    expect(second.preventDefault).toHaveBeenCalled();
    expect(win.sent).toEqual(['app:close-requested']);
  });

  it('closes anyway when the renderer never answers', () => {
    hs.onWindowClose(event());
    timer.fn();
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it('holds a quit, then re-issues it instead of closing the window', () => {
    const e = event();
    expect(hs.onBeforeQuit(e)).toBe(false);
    expect(e.preventDefault).toHaveBeenCalled();
    hs.ready();
    expect(quitApp).toHaveBeenCalledTimes(1);
    expect(win.close).not.toHaveBeenCalled();

    const again = event();
    expect(hs.onBeforeQuit(again)).toBe(true);
    expect(again.preventDefault).not.toHaveBeenCalled();
  });

  it('a quit that arrives while a close is pending wins', () => {
    hs.onWindowClose(event());
    expect(hs.onBeforeQuit(event())).toBe(false);
    hs.ready();
    expect(quitApp).toHaveBeenCalledTimes(1);
  });

  it('lets the close through when there is no live page to ask', () => {
    win.webContents.crashed = true;
    const e = event();
    expect(hs.onBeforeQuit(e)).toBe(true);
    hs.onWindowClose(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(win.sent).toEqual([]);
  });

  it('lets a quit through when no window is attached', () => {
    const bare = createCloseHandshake({ quitApp });
    expect(bare.onBeforeQuit(event())).toBe(true);
  });

  it('starts fresh for a new window (macOS re-creates it from the dock)', () => {
    hs.onWindowClose(event());
    hs.ready();
    const next = fakeWindow();
    hs.attachWindow(next);
    const e = event();
    hs.onWindowClose(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(next.sent).toEqual(['app:close-requested']);
  });

  it('an answer with nothing pending does nothing', () => {
    hs.ready();
    expect(win.close).not.toHaveBeenCalled();
    expect(quitApp).not.toHaveBeenCalled();
  });
});
