import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { createSessionNetworkDiagnostics, registerSessionNetworkDiagnostics, STAGE_PATHS } = createRequire(import.meta.url)('./session-network-diagnostics.js');

const BACKEND = 'https://backend.test';
const RAY = '0123456789abcdef-NRT';
const request = (extra = {}) => ({ id: 17, webContentsId: 3, method: 'POST', url: `${BACKEND}/api/soniox/session-key`, ...extra });
function sender(id = 3) {
  return Object.assign(new EventEmitter(), { id, send: vi.fn(), isDestroyed: () => false });
}
function setup() {
  let time = 100;
  const owner = sender();
  const diagnostics = createSessionNetworkDiagnostics({ backendUrl: BACKEND, now: () => time, timestamp: () => 123456 });
  return { owner, diagnostics, advance: (ms) => { time += ms; }, records: () => owner.send.mock.calls.map(([, data]) => data) };
}

describe('Managed session transport diagnostics', () => {
  it('captures nothing by default; disabling drops in-flight data, including after re-enabling', () => {
    const h = setup();
    h.diagnostics.beforeRequest(request());
    h.diagnostics.errorOccurred(request({ error: 'net::ERR_NAME_NOT_RESOLVED' }));
    expect(h.records()).toEqual([]);
    h.diagnostics.setEnabled(h.owner, true);
    h.diagnostics.beforeRequest(request());
    h.diagnostics.setEnabled(h.owner, false);
    h.diagnostics.headersReceived(request({ responseHeaders: { 'cf-ray': [RAY] } }));
    h.diagnostics.setEnabled(h.owner, true);
    h.diagnostics.completed(request({ statusCode: 200 }));
    expect(h.records()).toHaveLength(1);
    h.diagnostics.beforeRequest(request({ id: 18 }));
    h.diagnostics.completed(request({ id: 18, statusCode: 200 }));
    expect(h.records().at(-1)).toMatchObject({ requestId: 18, phase: 'completed', status: 200 });
  });

  it.each(STAGE_PATHS)('records %s at %s, and only on the configured backend', (stage, suffix) => {
    const h = setup();
    h.diagnostics.setEnabled(h.owner, true);
    const details = request({ url: `${BACKEND}${suffix}` });
    h.diagnostics.beforeRequest(details);
    h.diagnostics.completed({ ...details, statusCode: 200 });
    expect(h.records().map((r) => [r.stage, r.path])).toEqual([[stage, suffix], [stage, suffix]]);
    // The same path on another origin is not ours.
    h.diagnostics.beforeRequest(request({ id: 18, url: `https://other.test${suffix}` }));
    h.diagnostics.completed(request({ id: 18, url: `https://other.test${suffix}`, statusCode: 200 }));
    expect(h.records()).toHaveLength(2);
  });

  it('covers both providers and no other endpoint', () => {
    expect(STAGE_PATHS.map(([stage]) => stage)).toEqual([
      'soniox.session-key', 'soniox.reissue', 'soniox.started', 'soniox.end',
      'qwen.session-key', 'qwen.reissue', 'qwen.started', 'qwen.end',
    ]);
    const h = setup();
    h.diagnostics.setEnabled(h.owner, true);
    for (const path of ['/api/qwen/session-key/extra', '/api/qwen/session-startedx', '/api/qwen/session', '/api/soniox/session-started/x', '/api/soniox/session-end/']) {
      h.diagnostics.beforeRequest(request({ url: `${BACKEND}${path}` }));
    }
    expect(h.records()).toEqual([]);
  });

  it.each([200, 401, 409, 502, 503])('retains HTTP %i and case-insensitive CF-Ray with duration, once', (status) => {
    const h = setup();
    h.diagnostics.setEnabled(h.owner, true);
    h.diagnostics.beforeRequest(request());
    h.advance(45);
    h.diagnostics.headersReceived(request({ statusCode: status, responseHeaders: { 'CF-Ray': [RAY], 'set-cookie': ['secret'] } }));
    h.advance(5);
    h.diagnostics.completed(request());
    h.diagnostics.completed(request());
    expect(h.records()).toEqual([
      { requestId: 17, stage: 'soniox.session-key', path: '/api/soniox/session-key', timestamp: 123456, phase: 'started', durationMs: 0 },
      { requestId: 17, stage: 'soniox.session-key', path: '/api/soniox/session-key', timestamp: 123456, phase: 'completed', durationMs: 50, status, cfRay: RAY },
    ]);
  });

  it.each(['net::ERR_NAME_NOT_RESOLVED', 'net::ERR_CONNECTION_RESET', 'net::ERR_ABORTED'])('records %s on a reissue without inventing a cancellation cause', (error) => {
    const h = setup();
    h.diagnostics.setEnabled(h.owner, true);
    const details = request({ url: `${BACKEND}/api/soniox/session-key/reissue` });
    h.diagnostics.beforeRequest(details);
    h.advance(15000);
    h.diagnostics.errorOccurred({ ...details, error });
    expect(h.records().at(-1)).toEqual({ requestId: 17, stage: 'soniox.reissue', path: '/api/soniox/session-key/reissue', timestamp: 123456, phase: 'error', durationMs: 15000, chromiumError: error });
  });

  it('keeps a response status and CF-Ray when reading the body then fails', () => {
    const h = setup();
    h.diagnostics.setEnabled(h.owner, true);
    h.diagnostics.beforeRequest(request());
    h.diagnostics.headersReceived(request({ statusCode: 200, responseHeaders: { 'cf-ray': [RAY] } }));
    h.diagnostics.errorOccurred(request({ error: 'net::ERR_CONNECTION_CLOSED' }));
    expect(h.records().at(-1)).toMatchObject({ status: 200, cfRay: RAY, chromiumError: 'net::ERR_CONNECTION_CLOSED' });
  });

  it('allowlists paths, origin, method and renderer; no full URL, query, credentials, body, IP or arbitrary header/error escapes', () => {
    const h = setup();
    h.diagnostics.setEnabled(h.owner, true);
    for (const extra of [
      { url: 'https://other.test/api/soniox/session-key' },
      { url: `${BACKEND}/api/auth/sign-in` },
      { url: `${BACKEND}/api/soniox/session-key/extra` },
      { url: 'https://user:password@backend.test/api/soniox/session-key' },
      { method: 'OPTIONS' }, { method: 'GET' }, { webContentsId: 4 },
    ]) h.diagnostics.beforeRequest(request(extra));
    expect(h.records()).toEqual([]);
    const secret = 'private-value';
    const details = request({ url: `${BACKEND}/api/soniox/session-key?token=${secret}`, requestHeaders: { Authorization: secret, Cookie: secret }, uploadData: [{ bytes: secret }], ip: secret });
    h.diagnostics.beforeRequest(details);
    h.diagnostics.errorOccurred({ ...details, error: `net::ERR_ABORTED ${secret}`, statusCode: 999, responseHeaders: { 'cf-ray': [`${RAY}\n${secret}`], Authorization: secret } });
    const text = JSON.stringify(h.records());
    expect(text).not.toContain(secret);
    expect(text).not.toContain('https:');
    expect(text).not.toContain('Authorization');
    expect(h.records().at(-1)).not.toHaveProperty('chromiumError');
    expect(h.records().at(-1)).not.toHaveProperty('cfRay');
    expect(h.records().at(-1)).not.toHaveProperty('status');
  });

  it.each(['destroyed', 'render-process-gone', 'did-start-navigation'])('stops capture on %s and detaches lifecycle listeners', (event) => {
    const h = setup();
    h.diagnostics.setEnabled(h.owner, true);
    h.diagnostics.beforeRequest(request());
    h.owner.emit(event, {}, 'https://navigation.test', false, true);
    h.diagnostics.errorOccurred(request({ error: 'net::ERR_ABORTED' }));
    h.diagnostics.beforeRequest(request({ id: 19 }));
    expect(h.records()).toHaveLength(1);
    expect(h.owner.eventNames()).toEqual([]);
  });

  it('keeps capture through iframe and same-document navigation, then clears on main navigation', () => {
    const h = setup();
    h.diagnostics.setEnabled(h.owner, true);
    h.owner.emit('did-start-navigation', {}, 'https://iframe.test', false, false);
    h.owner.emit('did-start-navigation', {}, 'https://app.test/#help', true, true);
    h.diagnostics.beforeRequest(request());
    h.diagnostics.completed(request());
    expect(h.records()).toHaveLength(2);
    h.owner.emit('did-start-navigation', {}, 'https://app.test/', false, true);
    h.diagnostics.beforeRequest(request({ id: 18 }));
    expect(h.records()).toHaveLength(2);
    expect(h.owner.eventNames()).toEqual([]);
  });

  it('drops requests redirected away from the configured POST endpoints', () => {
    const h = setup();
    h.diagnostics.setEnabled(h.owner, true);
    h.diagnostics.beforeRequest(request());
    h.diagnostics.beforeRequest(request({ url: 'https://other.test/private?token=secret' }));
    h.diagnostics.errorOccurred(request({ error: 'net::ERR_FAILED' }));
    expect(h.records()).toHaveLength(1); // the original allowlisted start only
    h.diagnostics.beforeRequest(request({ id: 18 }));
    h.diagnostics.completed(request({ id: 18, url: `${BACKEND}/api/private` }));
    expect(h.records()).toHaveLength(2);
  });

  it('handles a configured backend path and trailing slash without logging that URL', () => {
    const owner = sender();
    const diagnostics = createSessionNetworkDiagnostics({ backendUrl: `${BACKEND}/prefix/` });
    diagnostics.setEnabled(owner, true);
    diagnostics.beforeRequest(request());
    expect(owner.send).not.toHaveBeenCalled();
    diagnostics.beforeRequest(request({ url: `${BACKEND}/prefix/api/soniox/session-key?token=private` }));
    expect(owner.send).toHaveBeenCalledOnce();
    expect(owner.send.mock.calls[0][1].path).toBe('/api/soniox/session-key');
    expect(JSON.stringify(owner.send.mock.calls)).not.toContain('private');
    expect(JSON.stringify(owner.send.mock.calls)).not.toContain('prefix');
  });

  it('does not let a renderer send failure break a webRequest callback', () => {
    const h = setup();
    h.diagnostics.setEnabled(h.owner, true);
    h.owner.send.mockImplementation(() => { throw new Error('renderer disappeared'); });
    expect(() => h.diagnostics.beforeRequest(request())).not.toThrow();
    expect(h.owner.eventNames()).toEqual([]);
    h.owner.send.mockClear();
    h.diagnostics.beforeRequest(request({ id: 18 }));
    expect(h.owner.send).not.toHaveBeenCalled();
  });

  it('bounds stalled request retention and expires old records', () => {
    const h = setup();
    h.diagnostics.setEnabled(h.owner, true);
    for (let id = 0; id < 130; id++) h.diagnostics.beforeRequest(request({ id }));
    h.diagnostics.completed(request({ id: 0 }));
    expect(h.records()).toHaveLength(130);
    h.advance(60001);
    h.diagnostics.beforeRequest(request({ id: 131 }));
    h.diagnostics.completed(request({ id: 129 }));
    expect(h.records()).toHaveLength(131);
  });

  it('registers only unused webRequest events and restricts the toggle IPC to the main renderer', () => {
    const owner = sender();
    const handlers = {};
    const ipcMain = { handle: vi.fn((channel, handler) => { handlers[channel] = handler; }) };
    const webRequest = { onCompleted: vi.fn(), onErrorOccurred: vi.fn(), onBeforeRequest: vi.fn(), onHeadersReceived: vi.fn(), onBeforeSendHeaders: vi.fn() };
    const diagnostics = registerSessionNetworkDiagnostics({ ipcMain, webRequest, backendUrl: BACKEND, getMainWindow: () => ({ webContents: owner }) });
    expect(webRequest.onCompleted).toHaveBeenCalledOnce();
    expect(webRequest.onErrorOccurred).toHaveBeenCalledOnce();
    expect(webRequest.onBeforeRequest).not.toHaveBeenCalled();
    expect(webRequest.onHeadersReceived).not.toHaveBeenCalled();
    expect(webRequest.onBeforeSendHeaders).not.toHaveBeenCalled();
    handlers['session-network:set-enabled']({ sender: sender(4) }, true);
    diagnostics.beforeRequest(request());
    expect(owner.send).not.toHaveBeenCalled();
    handlers['session-network:set-enabled']({ sender: owner }, true);
    diagnostics.beforeRequest(request());
    expect(owner.send).toHaveBeenCalledOnce();
    handlers['session-network:set-enabled']({ sender: owner }, 'true');
    diagnostics.beforeRequest(request());
    expect(owner.send).toHaveBeenCalledOnce();
  });
});
