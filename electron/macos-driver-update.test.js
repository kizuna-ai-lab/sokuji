// Replacing an installed virtual-audio driver older than the one the app ships.
//
// In-app updates replace Sokuji.app alone; only the pkg's postinstall ever
// copies the driver. So the app compares versions and, when they differ, copies
// its own driver over the installed one behind macOS's administrator prompt.
// These inject fakes for the file reads, osascript and the helper, as the other
// macos-audio-utils tests do, because the module is CommonJS.
import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveBundledDriverPath,
  readDriverVersion,
  checkDriverUpdate,
  driverSwapScript,
  installBundledDriver,
  INSTALLED_DRIVER_PATH,
} from './macos-driver-update.js';

const plist = (version) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
	<key>CFBundleExecutable</key>
	<string>SokujiVirtualAudio</string>
	<key>CFBundleShortVersionString</key>
	<string>${version}</string>
</dict></plist>`;

/** A readFile that answers each driver path's Info.plist with that version, and fails for the rest. */
const plists = (versions) => vi.fn(async (file) => {
  for (const [driver, version] of Object.entries(versions)) {
    if (file === path.join(driver, 'Contents', 'Info.plist')) return plist(version);
  }
  throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
});

describe('readDriverVersion', () => {
  it("reads the bundle's CFBundleShortVersionString", async () => {
    expect(await readDriverVersion('/x.driver', { readFile: plists({ '/x.driver': '0.6.1.1' }) })).toBe('0.6.1.1');
  });
  it('is null for a missing bundle or key', async () => {
    expect(await readDriverVersion('/missing.driver', { readFile: plists({}) })).toBeNull();
    expect(await readDriverVersion('/x.driver', { readFile: async () => '<plist><dict></dict></plist>' })).toBeNull();
    expect(await readDriverVersion(null)).toBeNull();
  });
});

describe('checkDriverUpdate', () => {
  const installedPath = '/HAL/SokujiVirtualAudio.driver';
  const bundledPath = '/app/resources/drivers/SokujiVirtualAudio.driver';

  it('reports both versions when they differ', async () => {
    const readFile = plists({ [installedPath]: '0.6.1', [bundledPath]: '0.6.1.1' });
    expect(await checkDriverUpdate({ installedPath, bundledPath, readFile })).toEqual({ installed: '0.6.1', bundled: '0.6.1.1' });
  });
  // Equality, not order: the app's own driver is the one it was tested with.
  it('also offers the app\'s driver over a different one that looks newer', async () => {
    const readFile = plists({ [installedPath]: '0.6.1.2', [bundledPath]: '0.6.1.1' });
    expect(await checkDriverUpdate({ installedPath, bundledPath, readFile })).toEqual({ installed: '0.6.1.2', bundled: '0.6.1.1' });
  });
  it('is null when they match', async () => {
    const readFile = plists({ [installedPath]: '0.6.1.1', [bundledPath]: '0.6.1.1' });
    expect(await checkDriverUpdate({ installedPath, bundledPath, readFile })).toBeNull();
  });
  // No driver installed is the pkg's to fix (and the not-installed status's to say).
  it('is null when either driver is missing', async () => {
    expect(await checkDriverUpdate({ installedPath, bundledPath, readFile: plists({ [bundledPath]: '0.6.1.1' }) })).toBeNull();
    expect(await checkDriverUpdate({ installedPath, bundledPath, readFile: plists({ [installedPath]: '0.6.1' }) })).toBeNull();
    expect(await checkDriverUpdate({ installedPath, bundledPath: null, readFile: plists({ [installedPath]: '0.6.1' }) })).toBeNull();
  });
});

describe('resolveBundledDriverPath', () => {
  it("prefers the packaged app's resources, then the repo", () => {
    const exists = (p) => p.startsWith('/res/') || p.startsWith('/repo/');
    expect(resolveBundledDriverPath({ resourcesPath: '/res', appPath: '/repo', existsSync: exists }))
      .toBe(path.join('/res', 'resources', 'drivers', 'SokujiVirtualAudio.driver'));
    expect(resolveBundledDriverPath({ resourcesPath: '/none', appPath: '/repo', existsSync: exists }))
      .toBe(path.join('/repo', 'resources', 'drivers', 'SokujiVirtualAudio.driver'));
    expect(resolveBundledDriverPath({ resourcesPath: '/none', appPath: '/none', existsSync: exists })).toBeNull();
  });
  it('finds the driver this repo ships', () => {
    expect(resolveBundledDriverPath({ resourcesPath: undefined })).toMatch(/resources[\\/]drivers[\\/]SokujiVirtualAudio\.driver$/);
  });
});

// The repo's own driver is the one the app compares against: its version has
// to be readable, and it must not be BlackHole's own version string.
describe("the driver this repo ships", () => {
  it('has a version the update check can read', async () => {
    const version = await readDriverVersion(resolveBundledDriverPath({ resourcesPath: undefined }));
    expect(version).toMatch(/^\d+(\.\d+)+$/);
    expect(version).not.toBe('0.6.1');
  });
});

describe('driverSwapScript', () => {
  // Run against a scratch directory standing in for the HAL directory: the
  // script is sh, and what matters is what it leaves behind.
  const run = (source, halDir) => {
    const script = driverSwapScript(source)
      .split(INSTALLED_DRIVER_PATH).join(path.join(halDir, 'SokujiVirtualAudio.driver'))
      .replace(/! chown -R root:wheel '[^']*' \|\| /g, '') // not root here
      .replace('/usr/bin/killall coreaudiod || true', 'true');
    return execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  };
  const driver = (dir, content) => {
    mkdirSync(path.join(dir, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(path.join(dir, 'Contents', 'MacOS', 'SokujiVirtualAudio'), content);
  };

  it('replaces the installed driver and leaves nothing else behind', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'sokuji-driver-'));
    try {
      const hal = path.join(tmp, 'HAL');
      mkdirSync(hal);
      driver(path.join(hal, 'SokujiVirtualAudio.driver'), 'old');
      const src = path.join(tmp, "it's app", 'SokujiVirtualAudio.driver'); // a quote in the path
      driver(src, 'new');
      run(src, hal);
      expect(readFileSync(path.join(hal, 'SokujiVirtualAudio.driver', 'Contents', 'MacOS', 'SokujiVirtualAudio'), 'utf8')).toBe('new');
      expect(existsSync(path.join(hal, 'SokujiVirtualAudio.driver.installing'))).toBe(false);
      expect(existsSync(path.join(hal, 'SokujiVirtualAudio.driver.previous'))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('keeps the installed driver when the copy fails', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'sokuji-driver-'));
    try {
      const hal = path.join(tmp, 'HAL');
      mkdirSync(hal);
      driver(path.join(hal, 'SokujiVirtualAudio.driver'), 'old');
      expect(() => run(path.join(tmp, 'missing.driver'), hal)).toThrow();
      expect(readFileSync(path.join(hal, 'SokujiVirtualAudio.driver', 'Contents', 'MacOS', 'SokujiVirtualAudio'), 'utf8')).toBe('old');
      expect(existsSync(path.join(hal, 'SokujiVirtualAudio.driver.installing'))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('restarts Core Audio last', () => {
    expect(driverSwapScript('/a').trim().endsWith('/usr/bin/killall coreaudiod || true')).toBe(true);
  });
});

describe('installBundledDriver', () => {
  const host = (...results) => {
    const ensureUnityGain = vi.fn();
    for (const r of results) ensureUnityGain.mockResolvedValueOnce(r);
    ensureUnityGain.mockResolvedValue(results[results.length - 1]);
    return { ensureUnityGain };
  };
  const noSleep = async () => {};

  it('runs the swap behind the administrator prompt and waits for the device', async () => {
    const execFile = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const h = host({ found: false }, { found: true, name: 'SokujiVirtualAudio' });
    const result = await installBundledDriver({ prompt: 'Update "it"', bundledPath: '/app/d.driver', execFile, host: h, sleep: noSleep });
    expect(result).toEqual({ ok: true });
    const [cmd, args] = execFile.mock.calls[0];
    expect(cmd).toBe('/usr/bin/osascript');
    expect(args[1]).toContain('with administrator privileges');
    expect(args[1]).toContain('with prompt "Update \\"it\\""');
    expect(h.ensureUnityGain).toHaveBeenCalledTimes(2);
  });

  it('treats a cancelled dialog as cancelled, not failed', async () => {
    const execFile = vi.fn(async () => { throw Object.assign(new Error('x'), { stderr: 'execution error: User canceled. (-128)' }); });
    expect(await installBundledDriver({ prompt: 'p', bundledPath: '/a', execFile, host: host({ found: true }) }))
      .toEqual({ ok: false, cancelled: true });
  });

  it('reports a swap that failed', async () => {
    const execFile = vi.fn(async () => { throw Object.assign(new Error('x'), { stderr: 'sokuji: staging the driver failed' }); });
    const result = await installBundledDriver({ prompt: 'p', bundledPath: '/a', execFile, host: host({ found: true }) });
    expect(result.ok).toBe(false);
    expect(result.cancelled).toBe(false);
    expect(result.error).toContain('staging the driver failed');
  });

  it('gives up when the device does not come back in time', async () => {
    let t = 0;
    const result = await installBundledDriver({
      prompt: 'p', bundledPath: '/a', execFile: vi.fn(async () => ({})), host: host({ found: false }),
      sleep: noSleep, now: () => (t += 1000), deadlineMs: 3000,
    });
    expect(result).toEqual({ ok: false, cancelled: false, error: 'The virtual device did not register after the driver update' });
  });

  it('does nothing without a driver to install', async () => {
    const execFile = vi.fn();
    const result = await installBundledDriver({ prompt: 'p', bundledPath: null, execFile });
    expect(result.ok).toBe(false);
    expect(execFile).not.toHaveBeenCalled();
  });
});
