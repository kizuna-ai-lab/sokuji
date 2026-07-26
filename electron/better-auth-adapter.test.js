// electron/better-auth-adapter.test.js
//
// The packaged renderer runs from a file:// origin, so it cannot rely on the
// browser attaching Better Auth's cookies to cross-site backend requests. This
// adapter mirrors those cookies into a main-process jar and hands main.js a
// config object for injecting them back onto outgoing requests (Electron only
// allows one onBeforeSendHeaders listener per session, so main.js owns the
// listener while this module owns the jar).
//
// The bug pinned down here: Better Auth prefixes its cookies with `__Secure-`
// as soon as the backend is reached over https (the prefix is derived from the
// request protocol — see better-auth's cookies/index.mjs). The capture filter
// only recognised the bare `better-auth.` names, so against a https backend the
// freshly issued `__Secure-better-auth.session_token` was dropped, and the
// injection then overwrote the browser's own Cookie header with the stale jar.
// Net effect: sign-in succeeds, the server sets a valid session cookie, and the
// app still renders the signed-out UI.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// better-auth-adapter.js is a CommonJS main-process file whose
// require('electron') is left as a native Node require by vite-node (the real
// build externalizes 'electron' the same way), so vi.mock('electron') cannot
// intercept it. Instead, load the module with Node's own require and pre-seed
// the module cache with a fake 'electron' — production code stays untouched.
// electron-conf is left real: pointing app.getPath() at a temp dir exercises
// the actual persistence path.
const nodeRequire = createRequire(import.meta.url);
const electronPath = nodeRequire.resolve('electron');
const modulePath = nodeRequire.resolve('./better-auth-adapter.js');

const BACKEND = 'https://sokuji.kizuna.ai';

let userDataDir;
let webRequestHandlers;

function loadAdapter() {
  webRequestHandlers = new Map();
  const fakeElectron = {
    app: { getPath: () => userDataDir },
    ipcMain: {
      handle: () => {},
      removeHandler: () => {},
      eventNames: () => [],
    },
    session: {
      defaultSession: {
        webRequest: {
          onBeforeRequest: (_filter, cb) => webRequestHandlers.set('beforeRequest', cb),
          onHeadersReceived: (_filter, cb) => webRequestHandlers.set('headersReceived', cb),
        },
      },
    },
  };
  nodeRequire.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: fakeElectron,
  };
  delete nodeRequire.cache[modulePath]; // fresh jar per test
  const { betterAuthAdapter } = nodeRequire(modulePath);
  betterAuthAdapter({ backendUrl: BACKEND, origin: 'file:///opt/Sokuji/resources/app' });
  return betterAuthAdapter;
}

/** Drive the real onHeadersReceived callback with a Set-Cookie response. */
function receiveSetCookie(...cookieStrings) {
  const onHeadersReceived = webRequestHandlers.get('headersReceived');
  onHeadersReceived({ responseHeaders: { 'set-cookie': cookieStrings } }, () => {});
}

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sokuji-auth-'));
});

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true });
});

describe('cookie capture', () => {
  it('stores the __Secure- prefixed session cookie issued over https', () => {
    const adapter = loadAdapter();

    receiveSetCookie('__Secure-better-auth.session_token=fresh; Path=/; HttpOnly; Secure');

    // Stored under its verbatim name — that is the name the server expects back.
    expect(adapter._sendHeadersConfig.getCookies()).toEqual({
      '__Secure-better-auth.session_token': 'fresh',
    });
  });

  it('still stores the bare name issued over http (localhost dev)', () => {
    const adapter = loadAdapter();

    receiveSetCookie('better-auth.session_token=fresh; Path=/');

    expect(adapter._sendHeadersConfig.getCookies()).toEqual({
      'better-auth.session_token': 'fresh',
    });
  });

  it('ignores cookies that are not Better Auth\'s', () => {
    const adapter = loadAdapter();

    receiveSetCookie('_ga=GA1.2.3; Path=/', '__Secure-_ga=GA1.2.3; Path=/');

    expect(adapter._sendHeadersConfig.getCookies()).toEqual({});
  });
});

describe('cookie injection', () => {
  it('keeps the browser-attached cookie when the jar holds a stale entry of the same name', () => {
    const adapter = loadAdapter();
    receiveSetCookie('__Secure-better-auth.session_token=stale');
    const headers = { Cookie: '__Secure-better-auth.session_token=fresh' };

    adapter._sendHeadersConfig.injectCookies(headers);

    // The header Chromium built reflects the live cookie store; the mirrored
    // jar is only a stand-in for when the browser attaches nothing.
    expect(headers.Cookie).toBe('__Secure-better-auth.session_token=fresh');
  });

  it('adds jar cookies the browser did not attach', () => {
    const adapter = loadAdapter();
    receiveSetCookie('better-auth.dont_remember=1');
    const headers = { Cookie: '__Secure-better-auth.session_token=fresh' };

    adapter._sendHeadersConfig.injectCookies(headers);

    expect(headers.Cookie).toBe('__Secure-better-auth.session_token=fresh; better-auth.dont_remember=1');
  });

  it('writes back into the header key Chromium already used, whatever its casing', () => {
    const adapter = loadAdapter();
    receiveSetCookie('better-auth.dont_remember=1');
    const headers = { cookie: '__Secure-better-auth.session_token=fresh' };

    adapter._sendHeadersConfig.injectCookies(headers);

    // A second entry differing only in case would go on the wire as a
    // duplicate Cookie header, which servers are free to reject.
    expect(Object.keys(headers)).toEqual(['cookie']);
    expect(headers.cookie).toBe('__Secure-better-auth.session_token=fresh; better-auth.dont_remember=1');
  });

  it('adds a Cookie header when the request carries none', () => {
    const adapter = loadAdapter();
    receiveSetCookie('__Secure-better-auth.session_token=from-jar');
    const headers = { Accept: '*/*' };

    adapter._sendHeadersConfig.injectCookies(headers);

    expect(headers.Cookie).toBe('__Secure-better-auth.session_token=from-jar');
  });

  it('leaves the request untouched when the jar is empty and no cookies are attached', () => {
    const adapter = loadAdapter();
    const headers = { Accept: '*/*' };

    adapter._sendHeadersConfig.injectCookies(headers);

    expect(headers).toEqual({ Accept: '*/*' });
  });

  it('preserves "=" characters inside an attached cookie value', () => {
    const adapter = loadAdapter();
    const headers = { Cookie: '__Secure-better-auth.session_token=abc.def%3D%3D' };

    adapter._sendHeadersConfig.injectCookies(headers);

    expect(headers.Cookie).toBe('__Secure-better-auth.session_token=abc.def%3D%3D');
  });
});
