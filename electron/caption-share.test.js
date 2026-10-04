// electron/caption-share.test.js
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const { setupCaptionShare } = require('./caption-share.js');

const STATE = { phase: 'live', pair: { source: 'ja', target: 'zh-CN' }, allowSave: false };
const v4 = (address) => ({ address, family: 'IPv4', internal: false });

function fakeServer() {
  let running = false;
  let port = null;
  let failCode = null;
  const listeners = new Set();
  const api = {
    calls: [],
    present: null,
    async start() {
      if (failCode) { const e = new Error(failCode); e.code = failCode; throw e; }
      running = true;
      port = 7788;
      return { port };
    },
    async stop() { running = false; port = null; api.calls.push('stop'); },
    patch: (p) => api.calls.push(['patch', p]),
    clear: (r) => api.calls.push(['clear', r]),
    setState: (st) => api.calls.push(['state', st]),
    setPresent: (info) => { api.present = info; },
    onViewersChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    running: () => running,
    port: () => port,
    viewers: () => 0,
    fail: (code) => { failCode = code; },
    emitViewers: (n) => { for (const fn of listeners) fn(n); },
  };
  return api;
}

function fakeWindow() {
  const web = new EventEmitter();
  web.sent = [];
  web.send = (channel, payload) => web.sent.push([channel, payload]);
  const win = new EventEmitter();
  win.webContents = web;
  win.isDestroyed = () => false;
  return win;
}

class FakeBrowserWindow extends EventEmitter {
  static all = [];
  constructor(opts) { super(); this.opts = opts; this.url = null; this.closed = false; this.focused = 0; FakeBrowserWindow.all.push(this); }
  loadURL(url) { this.url = url; }
  isDestroyed() { return this.closed; }
  close() { this.closed = true; this.emit('closed'); }
  show() {}
  focus() { this.focused += 1; }
}

let handlers, server, main, interfaces, beat, beats, ports, share;
const call = (channel, payload, sender = main.webContents) => handlers.get(channel)({ sender }, payload);

beforeEach(() => {
  handlers = new Map();
  FakeBrowserWindow.all = [];
  server = fakeServer();
  main = fakeWindow();
  interfaces = { wlan0: [v4('192.168.1.23')], docker0: [v4('172.17.0.1')] };
  beat = null;
  beats = 0;
  ports = async () => new Map();
  share = setupCaptionShare({
    ipcMain: { handle: (channel, fn) => { if (handlers.has(channel)) throw new Error(`twice: ${channel}`); handlers.set(channel, fn); } },
    BrowserWindow: FakeBrowserWindow,
    app: { getAppPath: () => '/app', on: () => {} },
    isTrustedSender: (sender) => sender === main.webContents,
    getMainWindow: () => main,
    isDev: false,
    networkInterfaces: () => interfaces,
    hardwarePorts: () => ports(),
    createServer: () => server,
    timers: { setInterval: (fn) => { beat = fn; beats += 1; return beats; }, clearInterval: () => { beats -= 1; } },
  });
  share.attachWindow(main);
});

describe('caption share glue', () => {
  it('registers the eight channels once', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'caption-share:clear', 'caption-share:patch', 'caption-share:present', 'caption-share:select-address',
      'caption-share:set-wifi', 'caption-share:start', 'caption-share:state', 'caption-share:stop',
    ]);
  });

  it('starts with ranked addresses, the first selected', async () => {
    const status = await call('caption-share:start', STATE);
    expect(status).toMatchObject({ running: true, port: 7788, selected: '192.168.1.23', viewers: 0, addressChanged: false });
    expect(status.addresses.map((a) => a.kind)).toEqual(['wifi', 'virtual']);
    expect(server.present.url).toBe('http://192.168.1.23:7788/');
  });

  it('refuses a call that is not from the main window', async () => {
    const result = await call('caption-share:start', STATE, {});
    expect(result).toEqual({ error: 'listen-failed', reason: 'not the main window' });
  });

  it('answers ports-busy when the server cannot listen', async () => {
    server.fail('ports-busy');
    expect(await call('caption-share:start', STATE)).toMatchObject({ error: 'ports-busy' });
  });

  it('pushes status to the main window when the viewer count changes', async () => {
    await call('caption-share:start', STATE);
    server.emitViewers(3);
    const last = main.webContents.sent.at(-1);
    expect(last[0]).toBe('caption-share:status');
    expect(last[1].viewers).toBe(3);
    expect(server.present.viewers).toBe(3);
  });

  it('replaces a vanished address on the next poll and flags it', async () => {
    await call('caption-share:start', STATE);
    interfaces = { wlan0: [v4('192.168.7.8')] };
    beat();
    const last = main.webContents.sent.at(-1)[1];
    expect(last.selected).toBe('192.168.7.8');
    expect(last.addressChanged).toBe(true);
    expect(server.present.url).toBe('http://192.168.7.8:7788/');
  });

  it('opens one present window, focuses it on a second call, and closes it on stop', async () => {
    await call('caption-share:start', STATE);
    await call('caption-share:present');
    await call('caption-share:present');
    expect(FakeBrowserWindow.all).toHaveLength(1);
    expect(FakeBrowserWindow.all[0].url).toBe('http://127.0.0.1:7788/present');
    expect(FakeBrowserWindow.all[0].focused).toBe(1);
    await call('caption-share:stop');
    expect(FakeBrowserWindow.all[0].closed).toBe(true);
    expect(server.calls).toContain('stop');
  });

  // The present window's navigator.languages is the OS locale, not Sokuji's UI
  // language; the host's window passes the UI language along.
  it("opens the present page in the host's UI language, and reloads it when that changed", async () => {
    await call('caption-share:start', STATE);
    await call('caption-share:present', { lang: 'zh_CN' });
    expect(FakeBrowserWindow.all[0].url).toBe('http://127.0.0.1:7788/present?lang=zh_CN');
    await call('caption-share:present', { lang: 'zh_CN' });
    await call('caption-share:present', { lang: 'ja' });
    expect(FakeBrowserWindow.all).toHaveLength(1);
    expect(FakeBrowserWindow.all[0].url).toBe('http://127.0.0.1:7788/present?lang=ja');
  });

  it('leaves out a language that is not a catalog id', async () => {
    await call('caption-share:start', STATE);
    await call('caption-share:present', { lang: 'x"><b>' });
    expect(FakeBrowserWindow.all[0].url).toBe('http://127.0.0.1:7788/present');
  });

  it('carries the Wi-Fi hint to the present page and drops an empty name', async () => {
    await call('caption-share:start', STATE);
    await call('caption-share:set-wifi', { wifi: { ssid: 'Meetup-Guest', password: 'pw' } });
    expect(server.present.wifi).toEqual({ ssid: 'Meetup-Guest', password: 'pw' });
    await call('caption-share:set-wifi', { wifi: { ssid: '  ', password: 'pw' } });
    expect(server.present.wifi).toBeNull();
  });

  it('ends the share when the main page navigates or its renderer is gone', async () => {
    await call('caption-share:start', STATE);
    main.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(server.running()).toBe(false);
    await call('caption-share:start', STATE);
    main.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    await new Promise((r) => setTimeout(r, 0));
    expect(server.running()).toBe(false);
  });

  // PR #597 review: a window that closes while the share is still starting
  // (the hardware-port lookup can take seconds on macOS) must not leave a
  // listener on the network that no window shows.
  it('a start the window closed under ends instead of serving', async () => {
    let release;
    ports = () => new Promise((resolve) => { release = () => resolve(new Map()); });
    const starting = call('caption-share:start', STATE);
    await new Promise((r) => setTimeout(r, 0)); // the start is looking up ports
    main.emit('closed');
    release();
    const result = await starting;
    expect(result).toMatchObject({ error: 'listen-failed' });
    expect(server.running()).toBe(false);
    expect(beats).toBe(0);
  });

  // PR #597 review: starts run one at a time, so a start the old window left
  // cannot stop the share a recreated window started meanwhile.
  it("a start from a recreated window outlives the closed window's start", async () => {
    let release;
    ports = () => new Promise((resolve) => { release = () => resolve(new Map()); });
    const first = call('caption-share:start', STATE);
    await new Promise((r) => setTimeout(r, 0)); // the first start is looking up ports
    main.emit('closed');
    const second = fakeWindow();
    main = second;
    share.attachWindow(second);
    ports = async () => new Map();
    const replacement = call('caption-share:start', STATE, second.webContents);
    release();
    expect(await first).toMatchObject({ error: 'listen-failed' });
    expect(await replacement).toMatchObject({ running: true, port: 7788 });
    expect(server.running()).toBe(true);
    expect(beats).toBe(1);
  });

  it('a second start while sharing answers the status without a second network poll', async () => {
    await call('caption-share:start', STATE);
    expect(beats).toBe(1);
    const again = await call('caption-share:start', STATE);
    expect(again).toMatchObject({ running: true, port: 7788 });
    expect(beats).toBe(1);
  });

  it('a window recreated on macOS gets the pushes without registering the handlers again', async () => {
    const second = fakeWindow();
    main = second;
    share.attachWindow(second);
    await call('caption-share:start', STATE);
    server.emitViewers(1);
    expect(second.webContents.sent.at(-1)[1].viewers).toBe(1);
    expect(handlers.size).toBe(8);
  });

  it('passes patches, clears and state through to the server', async () => {
    await call('caption-share:start', STATE);
    await call('caption-share:patch', { upsert: [{ id: 'a' }], remove: ['b', 3] });
    await call('caption-share:clear', { reason: 'restart' });
    await call('caption-share:state', { ...STATE, phase: 'idle' });
    expect(server.calls).toEqual([
      ['patch', { upsert: [{ id: 'a' }], remove: ['b'] }],
      ['clear', 'restart'],
      ['state', { ...STATE, phase: 'idle' }],
    ]);
  });
});
