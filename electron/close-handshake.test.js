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
  // Every case here runs mid-session; see 'only while a session is busy' below.
  beforeEach(() => hs.setSessionBusy(true));

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
    hs.setSessionBusy(true);
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

describe('only while a session is busy', () => {
  // The setup wizard, a loading page, an error screen and an idle main panel
  // have nothing to save and may have no listener to answer.
  it('lets a close and a quit through at once when no session is busy', () => {
    const close = event();
    hs.onWindowClose(close);
    const quit = event();
    expect(hs.onBeforeQuit(quit)).toBe(true);
    expect(close.preventDefault).not.toHaveBeenCalled();
    expect(quit.preventDefault).not.toHaveBeenCalled();
    expect(win.sent).toEqual([]);
    expect(timer).toBeNull();
  });

  it('stops holding once the renderer reports the session over', () => {
    hs.setSessionBusy(true);
    hs.setSessionBusy(false);
    const e = event();
    expect(hs.onBeforeQuit(e)).toBe(true);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(win.sent).toEqual([]);
  });

  it('a new window starts idle, whatever the old page reported', () => {
    hs.setSessionBusy(true);
    const next = fakeWindow();
    hs.attachWindow(next);
    const e = event();
    hs.onWindowClose(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(next.sent).toEqual([]);
  });
});

describe('endSessionThen (update install)', () => {
  it('runs at once when no session is busy', () => {
    const fn = vi.fn();
    hs.endSessionThen(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(win.sent).toEqual([]);
    expect(timer).toBeNull();
  });

  it('runs at once when there is no live page to ask', () => {
    hs.setSessionBusy(true);
    win.webContents.crashed = true;
    const fn = vi.fn();
    hs.endSessionThen(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(win.sent).toEqual([]);
  });

  it('asks the renderer to end a busy session first, and runs once it answers', () => {
    hs.setSessionBusy(true);
    const fn = vi.fn();
    hs.endSessionThen(fn);
    expect(win.sent).toEqual(['app:close-requested']);
    expect(timer.ms).toBe(DEFAULT_TIMEOUT_MS);
    expect(fn).not.toHaveBeenCalled();

    hs.ready();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(timer).toBeNull();
    expect(win.close).not.toHaveBeenCalled();
    expect(quitApp).not.toHaveBeenCalled();

    hs.ready(); // a stray second answer runs nothing again
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns to idle, not approved: a failed install leaves closing as it was', () => {
    hs.setSessionBusy(true);
    hs.endSessionThen(vi.fn());
    hs.ready();

    // Still busy (a new session, say): a close is held again.
    const held = event();
    hs.onWindowClose(held);
    expect(held.preventDefault).toHaveBeenCalled();
    expect(win.sent).toEqual(['app:close-requested', 'app:close-requested']);
    hs.ready();
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it('after it runs, a close with no session busy passes', () => {
    hs.setSessionBusy(true);
    hs.endSessionThen(vi.fn());
    hs.setSessionBusy(false); // what the renderer sends before it answers
    hs.ready();
    const e = event();
    hs.onWindowClose(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('runs when the renderer never answers, and does not hold the quit that follows', () => {
    hs.setSessionBusy(true);
    const fn = vi.fn();
    hs.endSessionThen(fn);
    timer.fn();
    expect(fn).toHaveBeenCalledTimes(1);

    // The install quits the app; waiting on the hung page a second time would
    // keep the old instance alive while the new one starts.
    const quit = event();
    expect(hs.onBeforeQuit(quit)).toBe(true);
    expect(quit.preventDefault).not.toHaveBeenCalled();
    expect(win.sent).toEqual(['app:close-requested']);
  });

  it('takes the place of a close already waiting on the renderer', () => {
    hs.setSessionBusy(true);
    hs.onWindowClose(event());
    const fn = vi.fn();
    hs.endSessionThen(fn);
    expect(win.sent).toEqual(['app:close-requested']); // not asked twice

    hs.ready();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(win.close).not.toHaveBeenCalled();
    expect(quitApp).not.toHaveBeenCalled();
  });

  it('takes the place of a quit already waiting on the renderer', () => {
    hs.setSessionBusy(true);
    hs.onBeforeQuit(event());
    const fn = vi.fn();
    hs.endSessionThen(fn);
    hs.ready();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(quitApp).not.toHaveBeenCalled();
  });

  it('a second request while one waits replaces it (no double install)', () => {
    hs.setSessionBusy(true);
    const first = vi.fn();
    const second = vi.fn();
    hs.endSessionThen(first);
    hs.endSessionThen(second);
    expect(win.sent).toEqual(['app:close-requested']);
    hs.ready();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('is not stranded when a new window replaces the page it was waiting on', () => {
    hs.setSessionBusy(true);
    const fn = vi.fn();
    hs.endSessionThen(fn);
    hs.attachWindow(fakeWindow());
    expect(fn).toHaveBeenCalledTimes(1);
    expect(timer).toBeNull();
  });
});
