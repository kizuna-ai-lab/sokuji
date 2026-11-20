// electron/main-window-navigation.test.js
//
// The main window keeps to the app's page: a link without a target (the
// update dialog's release notes) must not take the window, with the
// preload's IPC, to the web.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const electronPath = nodeRequire.resolve('electron');
const modulePath = nodeRequire.resolve('./main-window-navigation.js');

const openExternal = vi.fn();

function loadModule() {
  nodeRequire.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { shell: { openExternal: (...a) => openExternal(...a) } },
  };
  delete nodeRequire.cache[modulePath];
  return nodeRequire(modulePath);
}

function makeFakeWindow() {
  const listeners = new Map();
  return {
    webContents: {
      on: (event, fn) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(fn);
      },
    },
    /** Fires a navigation attempt; true when it was cancelled. */
    navigate(event, url) {
      const e = { preventDefault: vi.fn(), url };
      for (const fn of listeners.get(event) ?? []) fn(e, url);
      return e.preventDefault.mock.calls.length > 0;
    },
  };
}

const PACKAGED = 'file:///Applications/Sokuji.app/Contents/Resources/app.asar/build/index.html';
const DEV = 'http://localhost:5173';
const PR_LINK = 'https://github.com/kizuna-ai-lab/sokuji/pull/721';

describe('main window navigation', () => {
  let mod;

  beforeEach(() => {
    openExternal.mockClear();
    mod = loadModule();
  });

  afterEach(() => {
    delete nodeRequire.cache[electronPath];
    delete nodeRequire.cache[modulePath];
  });

  it('knows the app page, and nothing else', () => {
    expect(mod.isAppPage(PACKAGED, PACKAGED)).toBe(true);
    expect(mod.isAppPage(PR_LINK, PACKAGED)).toBe(false);
    expect(mod.isAppPage('http://localhost:5173/', DEV)).toBe(true);
    expect(mod.isAppPage(PR_LINK, DEV)).toBe(false);
  });

  it('sends a link clicked in the update notes to the system browser and keeps the app', () => {
    const win = makeFakeWindow();
    mod.guardMainWindowNavigation(win, PACKAGED);

    expect(win.navigate('will-navigate', PR_LINK)).toBe(true);
    expect(openExternal).toHaveBeenCalledWith(PR_LINK);
  });
});
