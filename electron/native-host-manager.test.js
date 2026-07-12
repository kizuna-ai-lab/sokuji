import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

// CJS require() that shares the Node module cache with the module under test.
// Monkey-patching built-ins (child_process, readline) here is visible to any
// subsequent require('child_process') / require('readline') inside native-host-manager.js.
const req = createRequire(import.meta.url);

import { parseHandshake, resolvePython } from './native-host-manager.js';

describe('parseHandshake', () => {
  it('extracts the bound port from the handshake JSON line', () => {
    expect(parseHandshake('{"port": 51791}')).toBe(51791);
  });
  it('returns null for non-handshake lines', () => {
    expect(parseHandshake('loading model…')).toBeNull();
    expect(parseHandshake('{"type":"ready"}')).toBeNull();
  });
});

describe('resolvePython', () => {
  it('honors SOKUJI_SIDECAR_PYTHON when set', () => {
    const prev = process.env.SOKUJI_SIDECAR_PYTHON;
    process.env.SOKUJI_SIDECAR_PYTHON = '/custom/python';
    expect(resolvePython()).toBe('/custom/python');
    process.env.SOKUJI_SIDECAR_PYTHON = prev;
  });
});

// ---------------------------------------------------------------------------
// Timeout-path tests for NativeHostManager.start()
//
// Approach: monkey-patch child_process.spawn and readline.createInterface on
// the shared CJS module cache via createRequire().  The module under test also
// uses require(), so both sides see the same cached export objects.
//
// We also set SOKUJI_SIDECAR_PYTHON (skips venv path) and HF_HOME (skips
// electron.app.getPath()) so the real Electron runtime is not needed.
// ---------------------------------------------------------------------------
describe('NativeHostManager.start() handshake timeout', () => {
  const cp = req('child_process');
  const rl = req('readline');

  let killSpy;
  let origSpawn;
  let origCreateInterface;

  beforeEach(() => {
    vi.useFakeTimers();

    // Stub env vars so start() skips electron.app.getPath() (via HF_HOME ||)
    // and resolvePython() returns a fixed path.
    process.env.SOKUJI_SIDECAR_PYTHON = '/fake/python';
    process.env.HF_HOME = '/fake/hf-home';

    // Save originals.
    origSpawn = cp.spawn;
    origCreateInterface = rl.createInterface;

    // Build a fake child that never emits the handshake line.
    killSpy = vi.fn();
    const fakeChild = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: killSpy,
    };

    // readline.createInterface returns a fake reader that stays silent.
    const fakeRl = { on: vi.fn(), off: vi.fn() };

    // Patch the shared CJS module cache objects.
    cp.spawn = vi.fn(() => fakeChild);
    rl.createInterface = vi.fn(() => fakeRl);
  });

  afterEach(() => {
    // Restore the originals before real-timers resume.
    cp.spawn = origSpawn;
    rl.createInterface = origCreateInterface;

    delete process.env.SOKUJI_SIDECAR_PYTHON;
    delete process.env.HF_HOME;

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects with timeout error, kills child, and clears _starting', async () => {
    // Import NativeHostManager here so it picks up the mocked spawn/readline.
    // (The module is already cached, so the class itself uses the same require()
    // cache objects that we patched above.)
    const { NativeHostManager } = await import('./native-host-manager.js');
    const manager = new NativeHostManager();

    // Call start() — no handshake will ever arrive → will timeout at the deadline.
    const p1 = manager.start();
    // Attach a catch immediately so Node does not report an unhandled rejection
    // while fake timers fire before the assertion below can add its own handler.
    const p1settled = p1.catch((e) => e);

    // Advance past the handshake deadline.
    const { HANDSHAKE_TIMEOUT_MS } = await import('./native-host-manager.js');
    await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS + 1);

    // 1. Promise rejects with the expected timeout message.
    const err = await p1settled;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('native-host handshake timeout');

    // 2. The orphaned child process was killed.
    expect(killSpy).toHaveBeenCalledOnce();

    // 3. _starting is cleared → a second call must return a NEW promise,
    //    not the same stale rejected one (which would make retries impossible).
    const p2 = manager.start();
    expect(p2).not.toBe(p1);

    // Attach a catch handler BEFORE advancing timers to avoid an unhandled
    // rejection warning while the second timeout fires.
    const p2settled = p2.catch(() => {});
    await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS + 1);
    await p2settled;
  });

  it('first-boot budget: handshake deadline is at least 90s (cold bundle import)', async () => {
    // Level B field finding: the first boot after a bundle install (cold page
    // cache + first onnxruntime import + CUDA preload) exceeded 30s on NVMe.
    const { HANDSHAKE_TIMEOUT_MS } = await import('./native-host-manager.js');
    expect(HANDSHAKE_TIMEOUT_MS).toBeGreaterThanOrEqual(90000);
  });

  it('logs the handshake duration and launch source on success', async () => {
    const { NativeHostManager } = await import('./native-host-manager.js');
    const manager = new NativeHostManager();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const p = manager.start();
    // Feed the handshake line through the recorded readline 'line' handler.
    const fakeRl = rl.createInterface.mock.results[0].value;
    const onLine = fakeRl.on.mock.calls.find(([ev]) => ev === 'line')[1];
    onLine(JSON.stringify({ port: 12345 }));
    await expect(p).resolves.toEqual({ port: 12345 });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/handshake in \d+ ms \(source: env, port 12345\)/));
  });

  it('rejects immediately (no watchdog wait) when the child exits pre-handshake', async () => {
    const { NativeHostManager } = await import('./native-host-manager.js');
    const manager = new NativeHostManager();
    const p = manager.start();
    const settled = p.catch((e) => e);
    // Fire the recorded 'exit' listener: the child crashed on boot.
    const fakeChild = cp.spawn.mock.results[0].value;
    const exitHandler = fakeChild.on.mock.calls.find(([ev]) => ev === 'exit')[1];
    exitHandler(1);
    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/exited before handshake/);
    // Cleared state → an immediate retry gets a fresh promise.
    expect(manager.start()).not.toBe(p);
  });
});

import { resolveSidecarLaunch } from './native-host-manager.js';

describe('resolveSidecarLaunch launch order', () => {
  const devCwd = '/repo/sidecar';
  const devVenv = '/repo/sidecar/.venv/bin/python';

  it('env override wins and keeps the dev cwd', () => {
    const l = resolveSidecarLaunch({
      platform: 'linux', envOverride: '/x/py', bundleRoot: '/u/sidecar/nvidia',
      devVenvPython: devVenv, devCwd, existsSync: () => true,
    });
    expect(l).toEqual({ python: '/x/py', cwd: devCwd, source: 'env' });
  });

  it('uses the installed bundle python when present (linux)', () => {
    const l = resolveSidecarLaunch({
      platform: 'linux', envOverride: undefined, bundleRoot: '/u/sidecar/nvidia',
      devVenvPython: devVenv, devCwd,
      existsSync: (p) => p === '/u/sidecar/nvidia/python/bin/python3',
    });
    expect(l.python).toBe('/u/sidecar/nvidia/python/bin/python3');
    expect(l.cwd).toBe('/u/sidecar/nvidia/app');
    expect(l.source).toBe('bundle');
  });

  it('windows bundle python is python/python.exe', () => {
    const l = resolveSidecarLaunch({
      platform: 'win32', envOverride: undefined, bundleRoot: 'C:\\u\\sidecar\\directml',
      devVenvPython: devVenv, devCwd, existsSync: () => true,
    });
    expect(l.python.endsWith(path.join('python', 'python.exe'))).toBe(true);
    expect(l.source).toBe('bundle');
  });

  it('falls back to the dev venv when no bundle is installed', () => {
    const l = resolveSidecarLaunch({
      platform: 'linux', envOverride: undefined, bundleRoot: '/u/sidecar/nvidia',
      devVenvPython: devVenv, devCwd, existsSync: () => false,
    });
    expect(l).toEqual({ python: devVenv, cwd: devCwd, source: 'venv' });
  });
});

describe('resolveSidecarLaunch strict version matching (spec S2)', () => {
  const base = {
    platform: 'linux', envOverride: undefined, bundleRoot: '/u/sidecar/linux-nvidia',
    devVenvPython: '/repo/sidecar/.venv/bin/python', devCwd: '/repo/sidecar',
    existsSync: () => true,
  };
  it('accepts the bundle when versions match', () => {
    const l = resolveSidecarLaunch({ ...base, requiredVersion: '0.1.0', readVersion: () => '0.1.0' });
    expect(l.source).toBe('bundle');
  });
  it('rejects a stale bundle and falls back to venv', () => {
    const l = resolveSidecarLaunch({ ...base, requiredVersion: '0.2.0', readVersion: () => '0.1.0' });
    expect(l.source).toBe('venv');
  });
  it('no requiredVersion keeps the old behavior (bundle accepted)', () => {
    const l = resolveSidecarLaunch({ ...base, requiredVersion: null, readVersion: () => '0.1.0' });
    expect(l.source).toBe('bundle');
  });
  it('env override bypasses the version gate entirely', () => {
    const l = resolveSidecarLaunch({
      ...base, envOverride: '/x/py', requiredVersion: '9.9.9', readVersion: () => '0.0.1',
    });
    expect(l.source).toBe('env');
  });
});
