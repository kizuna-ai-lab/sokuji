import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerEngineIpc, defaultHfHome } from './engine-ipc.js';
import { removeLegacySidecar, modelCachePaths } from './legacy-sidecar-cleanup.js';

class FakeChild extends EventEmitter {
  constructor() { super(); this.posted = []; }
  postMessage(m) { this.posted.push(m); }
  kill() { queueMicrotask(() => this.emit('exit', 137)); }
}

function setup({ sku = 'linux-x64', env = {}, packaged = false, runtimePresent = true, showOpenDialog } = {}) {
  const handlers = {};
  const children = [];
  const fork = vi.fn((_p, _a, opts) => { const c = new FakeChild(); c.opts = opts; children.push(c); return c; });
  registerEngineIpc({
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    showOpenDialog,
    app: { isPackaged: packaged, getPath: () => '/userData' },
    detectSku: () => sku,
    nativeVersion: '1.2.0',
    repoRoot: '/repo',
    enginePath: '/repo/dist-electron/engine.js',
    resourcesPath: '/app/resources',
    exists: () => runtimePresent,
    env,
    fork,
  });
  return { handlers, fork, children };
}

describe('engine IPC', () => {
  it('native-models:pick-files returns the paths the person chose, and none when they cancel', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ['/a/m.gguf', '/a/n.gguf'] }));
    const { handlers } = setup({ showOpenDialog });
    expect(await handlers['native-models:pick-files']({}, { title: 'Pick' })).toEqual({ ok: true, paths: ['/a/m.gguf', '/a/n.gguf'] });
    expect(showOpenDialog).toHaveBeenCalledWith({ title: 'Pick', properties: ['openFile', 'multiSelections'] });
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await handlers['native-models:pick-files']({}, {})).toEqual({ ok: true, paths: [] });
    expect(await setup().handlers['native-models:pick-files']({}, {})).toEqual({ ok: false, error: 'no dialog' });
  });

  it('sidecar-bundle:status answers ready with the native version', async () => {
    const { handlers } = setup();
    expect(await handlers['sidecar-bundle:status']()).toEqual({
      ok: true, sku: 'linux-x64', state: 'ready', installed: true, installedVersion: '1.2.0', requiredVersion: '1.2.0', stagedBytes: 0, devVenvPresent: false,
    });
  });

  it('sidecar-bundle:status does not call a missing runtime ready, and says how to get it', async () => {
    const { handlers } = setup({ runtimePresent: false });
    expect(await handlers['sidecar-bundle:status']()).toMatchObject({ ok: true, state: 'absent', installed: false, hint: expect.stringMatching(/npm run fetch:native/) });
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

  it('leaves everything alone when the model cache the user configured lives inside it', async () => {
    const ud = tmp();
    const cache = path.join(ud, 'sidecar', 'model-cache');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'model'), 'm');
    const log = vi.fn();
    await removeLegacySidecar(ud, { log, keep: [cache] });
    expect(fs.existsSync(path.join(cache, 'model'))).toBe(true);
    expect(log).toHaveBeenCalledWith('warn', expect.stringMatching(/model cache/));
    fs.rmSync(ud, { recursive: true, force: true });
  });

  it('protects every place the engine may keep its models: HF_HUB_CACHE and HUGGINGFACE_HUB_CACHE as well as HF_HOME', () => {
    expect(modelCachePaths({ HF_HUB_CACHE: '/a', HUGGINGFACE_HUB_CACHE: '/b', HF_HOME: '/c' })).toEqual(expect.arrayContaining(['/a', '/b', '/c', path.join('/c', 'hub')]));
    expect(modelCachePaths({})).toEqual([]);
  });

  it('keeps the folder when the cache is reached through a symlink that points inside it', async () => {
    const ud = tmp();
    const cache = path.join(ud, 'sidecar', 'cache');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'model'), 'm');
    const link = path.join(ud, 'models-link');
    fs.symlinkSync(cache, link);
    await removeLegacySidecar(ud, { log: vi.fn(), keep: [link] });
    expect(fs.existsSync(path.join(cache, 'model'))).toBe(true);
    fs.rmSync(ud, { recursive: true, force: true });
  });

  it('keeps the folder when userData itself is reached through a symlink', async () => {
    const ud = tmp();
    const cache = path.join(ud, 'sidecar', 'cache');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'model'), 'm');
    const viaLink = path.join(tmp(), 'userdata-link');
    fs.symlinkSync(ud, viaLink);
    await removeLegacySidecar(viaLink, { log: vi.fn(), keep: [cache] });
    expect(fs.existsSync(path.join(cache, 'model'))).toBe(true);
    fs.rmSync(ud, { recursive: true, force: true });
  });

  it.each(['darwin', 'win32'])('on %s, whose file systems ignore case, a cache named with other capitals is still inside', async (platform) => {
    const ud = tmp();
    const cache = path.join(ud, 'sidecar', 'model-cache');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'model'), 'm');
    const differentCase = path.join(ud, 'SIDECAR', 'Model-Cache');
    await removeLegacySidecar(ud, { log: vi.fn(), keep: [differentCase], platform });
    expect(fs.existsSync(path.join(cache, 'model'))).toBe(true);
    fs.rmSync(ud, { recursive: true, force: true });
  });

  it('on linux, where case matters, a differently capitalised path is another folder', async () => {
    const ud = tmp();
    fs.mkdirSync(path.join(ud, 'sidecar'), { recursive: true });
    await removeLegacySidecar(ud, { log: vi.fn(), keep: [path.join(ud, 'SIDECAR2', 'cache')], platform: 'linux' });
    expect(fs.existsSync(path.join(ud, 'sidecar'))).toBe(false);
    fs.rmSync(ud, { recursive: true, force: true });
  });

  it('keeps the folder when a configured cache path cannot be resolved at all', async () => {
    const ud = tmp();
    fs.mkdirSync(path.join(ud, 'sidecar'), { recursive: true });
    const log = vi.fn();
    await removeLegacySidecar(ud, { log, keep: [path.join(ud, 'sidecar', 'not-yet', 'cache')] });   // would be created inside it
    expect(fs.existsSync(path.join(ud, 'sidecar'))).toBe(true);
    fs.rmSync(ud, { recursive: true, force: true });
  });

  it.each([['hf-cache itself', ''], ['hf-cache/hub', 'hub']])('keeps the folder when the default %s the engine adds is a symlink into it', async (_name, sub) => {
    const ud = tmp();
    const cache = path.join(ud, 'sidecar', 'cache');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'model'), 'm');
    if (sub) { fs.mkdirSync(path.join(ud, 'hf-cache')); fs.symlinkSync(cache, path.join(ud, 'hf-cache', 'hub')); }
    else fs.symlinkSync(cache, path.join(ud, 'hf-cache'));
    const env = {};                                                           // the user set no cache variable at all
    const keep = modelCachePaths({ ...env, HF_HOME: defaultHfHome(env, ud) });   // what the engine will run with
    await removeLegacySidecar(ud, { log: vi.fn(), keep });
    expect(fs.existsSync(path.join(cache, 'model'))).toBe(true);
    fs.rmSync(ud, { recursive: true, force: true });
  });

  it('still removes it when the configured cache is elsewhere', async () => {
    const ud = tmp();
    fs.mkdirSync(path.join(ud, 'sidecar'), { recursive: true });
    await removeLegacySidecar(ud, { log: vi.fn(), keep: [path.join(ud, 'hf-cache')] });
    expect(fs.existsSync(path.join(ud, 'sidecar'))).toBe(false);
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
