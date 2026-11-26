import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerEngineIpc } from './engine-ipc.js';
import { removeLegacySidecar } from './legacy-sidecar-cleanup.js';

class FakeChild extends EventEmitter {
  constructor() { super(); this.posted = []; }
  postMessage(m) { this.posted.push(m); }
  kill() { queueMicrotask(() => this.emit('exit', 137)); }
}

function setup({ sku = 'linux-x64', env = {}, packaged = false } = {}) {
  const handlers = {};
  const children = [];
  const fork = vi.fn((_p, _a, opts) => { const c = new FakeChild(); c.opts = opts; children.push(c); return c; });
  registerEngineIpc({
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    app: { isPackaged: packaged, getPath: () => '/userData' },
    detectSku: () => sku,
    nativeVersion: '1.2.0',
    repoRoot: '/repo',
    enginePath: '/repo/dist-electron/engine.js',
    resourcesPath: '/app/resources',
    env,
    fork,
  });
  return { handlers, fork, children };
}

describe('engine IPC', () => {
  it('sidecar-bundle:status answers ready with the native version', async () => {
    const { handlers } = setup();
    expect(await handlers['sidecar-bundle:status']()).toEqual({
      ok: true, sku: 'linux-x64', state: 'ready', installed: true, installedVersion: '1.2.0', requiredVersion: '1.2.0', stagedBytes: 0, devVenvPresent: false,
    });
  });

  it('sidecar-bundle:status answers unsupported where detectSku is null', async () => {
    const { handlers } = setup({ sku: null });
    expect(await handlers['sidecar-bundle:status']()).toMatchObject({ ok: true, sku: null, state: 'unsupported', installed: false });
  });

  it('install, cancel and remove are no-ops that answer ok; manifest and usage answer empty', async () => {
    const { handlers, fork } = setup();
    expect(await handlers['sidecar-bundle:install']()).toMatchObject({ ok: true });
    expect(await handlers['sidecar-bundle:cancel']()).toEqual({ ok: true });
    expect(await handlers['sidecar-bundle:remove']()).toEqual({ ok: true });
    expect(await handlers['sidecar-bundle:manifest']()).toEqual({ ok: true, manifest: null });
    expect(await handlers['sidecar-bundle:usage']()).toEqual({ ok: true, bytes: 0 });
    expect(fork).not.toHaveBeenCalled();
  });

  it('native-host:start answers an error on an unsupported platform without forking', async () => {
    const { handlers, fork } = setup({ sku: null });
    expect(await handlers['native-host:start']()).toMatchObject({ ok: false, error: expect.stringMatching(/not available/) });
    expect(fork).not.toHaveBeenCalled();
  });

  it('native-host:start forks the engine and answers its port', async () => {
    const { handlers, children } = setup();
    const p = handlers['native-host:start']();
    children[0].emit('message', { type: 'ready', port: 4242 });
    expect(await p).toEqual({ ok: true, port: 4242 });
  });

  it('the engine env carries the native dir, the origins and HF_HOME defaulting to userData/hf-cache', async () => {
    const { handlers, children } = setup();
    const p = handlers['native-host:start']();
    const env = children[0].opts.env;
    expect(env.SOKUJI_NATIVE_DIR).toBe(path.join('/repo', 'resources', 'native'));
    expect(env.SOKUJI_ENGINE_ORIGINS).toBe('http://localhost:5173,file://');   // a dev build: both
    expect(env.HF_HOME).toBe(path.join('/userData', 'hf-cache'));
    children[0].emit('message', { type: 'ready', port: 1 });
    await p;
  });

  it('allows the origin a packaged page really sends (file://), never null, never the Better Auth marker', async () => {
    const { handlers, children } = setup({ packaged: true });
    const p = handlers['native-host:start']();
    const origins = children[0].opts.env.SOKUJI_ENGINE_ORIGINS.split(',');
    expect(origins).toContain('file://');
    expect(origins).not.toContain('null');
    expect(origins).not.toContain('file://sokuji');
    expect(origins).not.toContain('http://localhost:5173');                   // the dev server's origin is for a dev build only
    children[0].emit('message', { type: 'ready', port: 1 });
    await p;
  });

  it('a pre-set HF_HOME and SOKUJI_NATIVE_DIR win', async () => {
    const { handlers, children } = setup({ env: { HF_HOME: '/shared/hf', SOKUJI_NATIVE_DIR: '/mine' } });
    const p = handlers['native-host:start']();
    expect(children[0].opts.env.HF_HOME).toBe('/shared/hf');
    expect(children[0].opts.env.SOKUJI_NATIVE_DIR).toBe('/mine');
    children[0].emit('message', { type: 'ready', port: 1 });
    await p;
  });
});

describe('removeLegacySidecar', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-'));

  it('deletes userData/sidecar and leaves hf-cache alone', async () => {
    const ud = tmp();
    fs.mkdirSync(path.join(ud, 'sidecar', 'linux-x64'), { recursive: true });
    fs.writeFileSync(path.join(ud, 'sidecar', 'linux-x64', 'python'), 'x'.repeat(1000));
    fs.mkdirSync(path.join(ud, 'hf-cache'));
    fs.writeFileSync(path.join(ud, 'hf-cache', 'model'), 'm');
    const log = vi.fn();
    await removeLegacySidecar(ud, { log });
    expect(fs.existsSync(path.join(ud, 'sidecar'))).toBe(false);
    expect(fs.existsSync(path.join(ud, 'hf-cache', 'model'))).toBe(true);
    expect(log).toHaveBeenCalledWith('info', expect.stringMatching(/removed the old Python sidecar/));
    fs.rmSync(ud, { recursive: true, force: true });
  });

  it('does nothing when there is no sidecar directory', async () => {
    const ud = tmp();
    const log = vi.fn();
    await removeLegacySidecar(ud, { log });
    expect(log).not.toHaveBeenCalled();
    fs.rmSync(ud, { recursive: true, force: true });
  });

  it('swallows errors', async () => {
    const ud = tmp();
    fs.mkdirSync(path.join(ud, 'sidecar'));
    const log = vi.fn();
    await expect(removeLegacySidecar(ud, { rm: async () => { throw new Error('EBUSY'); }, log })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('warn', expect.stringMatching(/EBUSY/));
    fs.rmSync(ud, { recursive: true, force: true });
  });
});
