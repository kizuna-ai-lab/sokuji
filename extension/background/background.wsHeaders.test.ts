// The background worker cannot be booted in vitest (it imports a build-generated
// table and registers chrome listeners at load): its wiring of the generic
// upgrade header rules is asserted on its source text, as Electron's wiring
// tests do (Stage 2 OpenAI Live, choice 3).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequestIds } from './wsHeaderRule.js';

const background = readFileSync(join(__dirname, 'background.js'), 'utf8');
const viteConfig = readFileSync(join(__dirname, '..', 'vite.config.ts'), 'utf8');

/** Index of `needle` in `text`; fails (rather than returning -1) when it is gone. */
function at(text: string, needle: string): number {
  const i = text.indexOf(needle);
  expect(i, `expected to find ${needle}`).toBeGreaterThan(-1);
  return i;
}

/** A function's source, to its closing brace at the start of a line. */
function fn(name: string): string {
  const rest = background.slice(at(background, `function ${name}(`));
  return rest.slice(0, at(rest, '\n}') + 2);
}

describe('the background worker: the generic upgrade header rules', () => {
  it('imports the pure rules, which the build copies beside it', () => {
    expect(background).toContain("import { buildRule, createRequestIds, isExtensionPage, ruleIdsFor, ruleProblem, sweepIds } from './wsHeaderRule.js';");
    expect(viteConfig).toContain("{ src: 'background/wsHeaderRule.js', dest: '.' },");
  });

  it("answers WS_HEADERS_SET and WS_HEADERS_CLEAR only for the extension's own pages, checking the sender before anything", () => {
    const branch = background.slice(at(background, "if (message.type === 'WS_HEADERS_SET' || message.type === 'WS_HEADERS_CLEAR') {"));
    const check = at(branch, "if (!isExtensionPage(sender, chrome.runtime.id, chrome.runtime.getURL(''))) {");
    expect(check).toBeLessThan(at(branch, 'wsHeadersSet(message)'));
    expect(check).toBeLessThan(at(branch, 'wsHeadersClear(message)'));
    expect(branch.slice(check)).toContain("sendResponse({ success: false, error: 'Sender is not an extension page' });");
  });

  it('validates before the shared chain, chains every update on it, and never leaves it rejected', () => {
    const set = fn('wsHeadersSet');
    expect(at(set, 'ruleProblem(message)')).toBeLessThan(at(set, 'dnrUpdatePromise.then('));
    for (const name of ['wsHeadersSet', 'wsHeadersClear', 'wsHeadersSweep']) {
      const body = fn(name);
      expect(body, name).toContain('dnrUpdatePromise.then(');
      expect(body, name).toContain('dnrUpdatePromise = run.catch(() => {});');
    }
    expect(fn('wsHeadersSet')).toContain('removeRuleIds: [rule.id], addRules: [rule]');
    expect(fn('wsHeadersClear')).toContain('ruleIdsFor(');
    expect(fn('wsHeadersSweep')).toContain('sweepIds(');
  });

  it('sweeps the generic rules and the old Live and AST2 rules when the browser or the extension starts, since dynamic rules outlive both (Stage 2 OpenAI Live, ruling 11; Stage 2 deletion, ruling C3)', () => {
    expect(background).toContain('chrome.runtime.onStartup.addListener(() => { void wsHeadersSweep(); });');
    expect(background).toContain('chrome.runtime.onInstalled.addListener(() => { void wsHeadersSweep(); });');
  });
});

const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const HOST = 'maas.qwencloudapi.com';
const PATH = '/api-ws/v1/realtime';
const response = (over: Record<string, unknown> = {}) => ({
  url: `wss://${HOST}${PATH}?model=m`,
  initiator: ORIGIN,
  type: 'websocket',
  responseHeaders: [{ name: 'x-request-id', value: 'abc' }],
  ...over,
});

describe("the background worker: the handshake's request id", () => {
  it('answers the id of a websocket response from the extension for a set rule, once', () => {
    const ids = createRequestIds(ORIGIN);
    ids.set(HOST, PATH);
    ids.note(response());
    expect(ids.clear(HOST, PATH)).toBe('abc');
    expect(ids.clear(HOST, PATH)).toBeUndefined();
  });

  it('matches the header name in any case', () => {
    const ids = createRequestIds(ORIGIN);
    ids.set(HOST, PATH);
    ids.note(response({ responseHeaders: [{ name: 'X-Request-Id', value: 'abc' }] }));
    expect(ids.clear(HOST, PATH)).toBe('abc');
  });

  it('ignores a response for another host, another path, another initiator, or with no usable id', () => {
    const ids = createRequestIds(ORIGIN);
    ids.set(HOST, PATH);
    ids.note(response({ url: `wss://other.example.com${PATH}` }));
    ids.note(response({ url: `wss://${HOST}/elsewhere` }));
    ids.note(response({ initiator: 'https://meet.google.com' }));
    ids.note(response({ initiator: undefined }));
    ids.note(response({ responseHeaders: [{ name: 'x-request-id', value: '' }] }));
    ids.note(response({ responseHeaders: [{ name: 'x-request-id' }] }));
    ids.note(response({ responseHeaders: undefined }));
    expect(ids.clear(HOST, PATH)).toBeUndefined();
  });

  it('notes nothing for a rule that is not set, or was cleared', () => {
    const ids = createRequestIds(ORIGIN);
    ids.note(response());
    ids.set(HOST, PATH);
    expect(ids.clear(HOST, PATH)).toBeUndefined();
    ids.note(response());
    expect(ids.clear(HOST, PATH)).toBeUndefined();
  });

  it('gives the id to the rule with the longest matching path', () => {
    const ids = createRequestIds(ORIGIN);
    ids.set(HOST, '/api-ws/');
    ids.set(HOST, PATH);
    ids.note(response());
    expect(ids.clear(HOST, '/api-ws/')).toBeUndefined();
    expect(ids.clear(HOST, PATH)).toBe('abc');
  });

  it('forgets a stale id when the rule is set again', () => {
    const ids = createRequestIds(ORIGIN);
    ids.set(HOST, PATH);
    ids.note(response());
    ids.set(HOST, PATH);
    expect(ids.clear(HOST, PATH)).toBeUndefined();
  });

  it('is wired at the top level with the ruled filter, fed to the store, and answered on clear', () => {
    const listener = background.slice(at(background, 'chrome.webRequest.onHeadersReceived.addListener('));
    const call = listener.slice(0, at(listener, '\n);'));
    expect(call).toContain("{ urls: ['wss://maas.qwencloudapi.com/*'], types: ['websocket'] },\n  ['responseHeaders'],");
    expect(call).toContain('wsRequestIds.note(details)');
    expect(background).toContain("createRequestIds(chrome.runtime.getURL('').replace(/\\/$/, ''))");
    expect(fn('wsHeadersSet')).toContain('wsRequestIds.set(message.host, message.path)');
    expect(fn('wsHeadersClear')).toContain('return wsRequestIds.clear(message.host, message.path)');
    expect(background).toContain('{ success: true, requestId }');
  });

  it('declares the webRequest permission', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'manifest.json'), 'utf8'));
    expect(manifest.permissions).toContain('webRequest');
  });
});
