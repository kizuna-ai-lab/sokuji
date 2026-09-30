// electron/wsHeaderRules.wiring.test.js
//
// main.js cannot be booted in vitest: its wiring of the upgrade header rules
// is asserted on its source text, as closeHandshake.wiring.test.js does. The
// one onBeforeSendHeaders listener is shared with Better Auth's cookies and
// Origin and Bing's headers; those stay as they were (Stage 2 OpenAI Live,
// choice 2).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const main = readFileSync(join(__dirname, 'main.js'), 'utf8');

/** Index of `needle` in `text`; fails (rather than returning -1) when it is gone. */
function at(text, needle) {
  const i = text.indexOf(needle);
  expect(i, `expected to find ${needle}`).toBeGreaterThan(-1);
  return i;
}

/** The source of the `ipcMain.handle(channel, …)` registration. */
function handler(channel) {
  const start = at(main, `ipcMain.handle('${channel}'`);
  const rest = main.slice(start);
  return rest.slice(0, at(rest, '\n});') + 4);
}

describe('the upgrade header rules wiring', () => {
  it('builds its rules from the module, and keeps no map of its own', () => {
    expect(main).toContain("const { createWsHeaderRules } = require('./ws-header-rules.js');");
    expect(main).toContain('const wsHeaderRules = createWsHeaderRules();');
    expect(main).not.toMatch(/wsHeaderRules\.(get|delete)\(/);
  });

  it('applies the rule an upgrade matches inside the one listener, after Better Auth and before Bing', () => {
    const listener = main.slice(at(main, 'session.defaultSession.webRequest.onBeforeSendHeaders('));
    const auth = at(listener, 'authConfig.injectCookies(requestHeaders);');
    const take = at(listener, "if (details.resourceType === 'webSocket') {\n        wsHeaderRules.take(details.url, requestHeaders);\n      }");
    const bing = at(listener, "details.url.startsWith('https://www.bing.com/translator')");
    expect(auth).toBeLessThan(take);
    expect(take).toBeLessThan(bing);
    expect(at(listener, 'callback({ requestHeaders });')).toBeGreaterThan(bing);
  });

  it('registers and clears through the module, logging header names only', () => {
    const set = handler('ws-headers-set');
    expect(set).toContain('const result = wsHeaderRules.set(args);');
    expect(set).toContain('Object.keys(headers)');
    expect(set).not.toMatch(/Object\.values\(headers\)|headers\[/);
    expect(set).toContain('return result;');
    const clear = handler('ws-headers-clear');
    expect(clear).toContain('const result = wsHeaderRules.clear(args);');
    expect(clear).toContain('return result;');
  });
});
