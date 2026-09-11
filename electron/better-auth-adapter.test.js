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

/**
 * Require the adapter module against a fake 'electron'. Every load must go
 * through here: a bare require would let electron-conf bind the real module
 * (a path string under Node) and stay cached that way for the whole file.
 */
function loadModule() {
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
  return nodeRequire(modulePath);
}

function loadAdapter() {
  const { betterAuthAdapter, PACKAGED_ORIGIN } = loadModule();
  // Same call main.js makes in a packaged build.
  betterAuthAdapter({ backendUrl: BACKEND, origin: PACKAGED_ORIGIN });
  return betterAuthAdapter;
}

/** Drive the real onHeadersReceived callback with a Set-Cookie response. */
function receiveSetCookie(...cookieStrings) {
  const onHeadersReceived = webRequestHandlers.get('headersReceived');
  onHeadersReceived({ responseHeaders: { 'set-cookie': cookieStrings } }, () => {});
}

/** Drive the real onHeadersReceived callback and return the headers it emits. */
function receiveResponse(responseHeaders = {}) {
  let emitted;
  webRequestHandlers.get('headersReceived')({ responseHeaders }, (result) => {
    emitted = result.responseHeaders;
  });
  return emitted;
}

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sokuji-auth-'));
});

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true });
});

// Issue #535. The packaged build used to send `file://${__dirname}` as Origin
// and Referer on every backend request. On Windows that path sits under
// C:\Users\<username>\AppData\Local\sokuji, so the account name left the
// machine twice per request and landed verbatim in the Worker's logs, with a
// runtime warning per header whenever the name was non-ASCII. The backend only
// checks that the value starts with `file://` (better-auth matches non-http(s)
// origins by prefix), so nothing depends on the path that followed.
describe('packaged origin', () => {
  it('is a fixed printable-ASCII value, so no header warning and no install path', () => {
    const { PACKAGED_ORIGIN } = loadModule();

    expect(PACKAGED_ORIGIN).toMatch(/^[\x21-\x7e]+$/);
  });

  it('keeps the file:// prefix the backend trusts desktop requests by', () => {
    const { PACKAGED_ORIGIN } = loadModule();

    expect(PACKAGED_ORIGIN.startsWith('file://')).toBe(true);
  });

  it('carries no path, so nothing from the local filesystem can ride along', () => {
    const { PACKAGED_ORIGIN } = loadModule();
    const rest = PACKAGED_ORIGIN.slice('file://'.length);

    expect(rest).not.toMatch(/[\\/:]/);
    expect(rest).not.toBe('');
  });

  it('is what the adapter echoes back as access-control-allow-origin', () => {
    const adapter = loadAdapter();

    const headers = receiveResponse();

    expect(adapter._sendHeadersConfig.origin).toBe('file://sokuji');
    expect(headers['access-control-allow-origin']).toEqual(['file://sokuji']);
  });
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
