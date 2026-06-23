import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

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

    // Call start() — no handshake will ever arrive → will timeout after 30 s.
    const p1 = manager.start();
    // Attach a catch immediately so Node does not report an unhandled rejection
    // while fake timers fire before the assertion below can add its own handler.
    const p1settled = p1.catch((e) => e);

    // Advance past the 30-second deadline.
    await vi.advanceTimersByTimeAsync(30001);

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
    await vi.advanceTimersByTimeAsync(30001);
    await p2settled;
  });
});
