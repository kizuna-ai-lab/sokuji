import { describe, it, expect, vi } from 'vitest';
import {
  parseIcaclsAces,
  findExplicitOrphanSids,
  isGpuSandboxCrash,
  evaluateCrashRelaunch,
  evaluateNoSandbox,
  scanDirectory,
  repairDirectory,
  buildBackupLog,
  getScanDirectories,
  applyNoSandboxFlag,
  registerCrashDetection,
  handleRecoveryMode,
  CRASH_MARKER,
  FALLBACK_MARKER,
} from './sandbox-recovery.js';

// A realistic orphan AppContainer package SID: "S-1-15-2" followed by 7
// sub-authority groups. Matches /S-1-15-2(?:-\d+){6,}/.
const ORPHAN_A =
  'S-1-15-2-1111111111-2222222222-3333333333-4444444444-5555555555-6666666666-7777777777';
const ORPHAN_B =
  'S-1-15-2-3624051433-2125758914-1423191267-1740899205-1073925389-3782572162-737981194';

// A clean, healthy directory ACL — no AppContainer package SIDs at all.
const CLEAN = [
  'C:\\SokujiSandboxTest NT AUTHORITY\\SYSTEM:(OI)(CI)(F)',
  '                     BUILTIN\\Administrators:(OI)(CI)(F)',
  '                     CREATOR OWNER:(OI)(CI)(IO)(F)',
  '                     BUILTIN\\Users:(OI)(CI)(RX)',
  '',
  'Successfully processed 1 files; Failed processing 0 files.',
].join('\r\n');

// An EXPLICIT orphan ACE (no "(I)" inherited flag) plus normal inherited ACEs.
const EXPLICIT_ORPHAN = [
  `C:\\SokujiSandboxTest ${ORPHAN_A}:(OI)(CI)(F)`,
  '                     NT AUTHORITY\\SYSTEM:(I)(OI)(CI)(F)',
  '                     BUILTIN\\Administrators:(I)(OI)(CI)(F)',
  '',
  'Successfully processed 1 files; Failed processing 0 files.',
].join('\r\n');

// The SAME orphan SID but INHERITED (has the "(I)" flag) — must be ignored,
// because we only remove explicit ACEs at the directory that defines them.
const INHERITED_ORPHAN = [
  `C:\\Users\\jiang\\AppData\\Local\\Sokuji ${ORPHAN_A}:(I)(OI)(CI)(F)`,
  '                                         NT AUTHORITY\\SYSTEM:(I)(OI)(CI)(F)',
  '',
  'Successfully processed 1 files; Failed processing 0 files.',
].join('\r\n');

// Legit AppContainer well-known SIDs shown as RAW SIDs must NOT match:
// S-1-15-2-1 (ALL APPLICATION PACKAGES) and S-1-15-2-2 (ALL RESTRICTED
// APPLICATION PACKAGES) each have only ONE sub-authority after S-1-15-2.
const LEGIT_WELLKNOWN = [
  'C:\\SokujiSandboxTest S-1-15-2-1:(OI)(CI)(RX)',
  '                     S-1-15-2-2:(OI)(CI)(RX)',
  '                     Everyone:(RX)',
  '',
  'Successfully processed 1 files; Failed processing 0 files.',
].join('\r\n');

// A non-English (Chinese) localized "account unknown" label wrapping an
// explicit orphan SID. The account name is localized; the SID is stable. We
// must extract by SID, never by name.
const NON_ENGLISH_LOCALE = [
  `C:\\SokujiSandboxTest 账户未知(${ORPHAN_B}):(OI)(CI)(F)`,
  '                     NT AUTHORITY\\SYSTEM:(I)(OI)(CI)(F)',
  '',
  'Successfully processed 1 files; Failed processing 0 files.',
].join('\r\n');

describe('parseIcaclsAces', () => {
  it('returns no ACEs for a clean directory', () => {
    expect(parseIcaclsAces(CLEAN)).toEqual([]);
  });

  it('flags an explicit orphan ACE as not inherited', () => {
    const aces = parseIcaclsAces(EXPLICIT_ORPHAN);
    expect(aces).toEqual([{ sid: ORPHAN_A, inherited: false }]);
  });

  it('flags an inherited orphan ACE as inherited', () => {
    const aces = parseIcaclsAces(INHERITED_ORPHAN);
    expect(aces).toEqual([{ sid: ORPHAN_A, inherited: true }]);
  });

  it('ignores legit well-known S-1-15-2-1 / S-1-15-2-2 raw SIDs', () => {
    expect(parseIcaclsAces(LEGIT_WELLKNOWN)).toEqual([]);
  });

  it('extracts the SID even when wrapped in a localized account name', () => {
    const aces = parseIcaclsAces(NON_ENGLISH_LOCALE);
    expect(aces).toEqual([{ sid: ORPHAN_B, inherited: false }]);
  });
});

describe('findExplicitOrphanSids', () => {
  it('returns [] for a clean directory', () => {
    expect(findExplicitOrphanSids(CLEAN)).toEqual([]);
  });

  it('returns the explicit orphan SID', () => {
    expect(findExplicitOrphanSids(EXPLICIT_ORPHAN)).toEqual([ORPHAN_A]);
  });

  it('does NOT return an inherited orphan SID', () => {
    expect(findExplicitOrphanSids(INHERITED_ORPHAN)).toEqual([]);
  });

  it('does NOT return legit well-known SIDs', () => {
    expect(findExplicitOrphanSids(LEGIT_WELLKNOWN)).toEqual([]);
  });

  it('deduplicates repeated explicit orphan SIDs', () => {
    const doubled = [
      `C:\\SokujiSandboxTest ${ORPHAN_A}:(OI)(F)`,
      `                     ${ORPHAN_A}:(CI)(F)`,
      '',
    ].join('\r\n');
    expect(findExplicitOrphanSids(doubled)).toEqual([ORPHAN_A]);
  });
});

describe('isGpuSandboxCrash', () => {
  const base = { type: 'GPU', reason: 'crashed', exitCode: -2147483645 };

  it('matches a GPU crash with signed STATUS_BREAKPOINT exit code', () => {
    expect(isGpuSandboxCrash({ ...base, exitCode: -2147483645 })).toBe(true);
  });

  it('matches a GPU crash with unsigned STATUS_BREAKPOINT exit code', () => {
    expect(isGpuSandboxCrash({ ...base, exitCode: 2147483651 })).toBe(true);
  });

  it('matches reason "abnormal-exit"', () => {
    expect(isGpuSandboxCrash({ ...base, reason: 'abnormal-exit' })).toBe(true);
  });

  it('rejects non-GPU process types', () => {
    expect(isGpuSandboxCrash({ ...base, type: 'Utility' })).toBe(false);
  });

  it('rejects unrelated reasons like clean-exit', () => {
    expect(isGpuSandboxCrash({ ...base, reason: 'clean-exit' })).toBe(false);
  });

  it('rejects a GPU crash with a different exit code', () => {
    expect(isGpuSandboxCrash({ ...base, exitCode: 1 })).toBe(false);
  });

  it('rejects null/undefined details', () => {
    expect(isGpuSandboxCrash(null)).toBe(false);
    expect(isGpuSandboxCrash(undefined)).toBe(false);
  });
});

describe('evaluateCrashRelaunch', () => {
  const V = '0.34.1';

  it('relaunches on the first crash (no prior marker)', () => {
    const { marker, shouldRelaunch } = evaluateCrashRelaunch(null, 1000, V);
    expect(shouldRelaunch).toBe(true);
    expect(marker).toEqual({ timestamps: [1000], appVersion: V });
  });

  it('relaunches on the second crash within the hour', () => {
    const prior = { timestamps: [1000], appVersion: V };
    const { marker, shouldRelaunch } = evaluateCrashRelaunch(prior, 2000, V);
    expect(shouldRelaunch).toBe(true);
    expect(marker.timestamps).toEqual([1000, 2000]);
  });

  it('does NOT relaunch on the third crash within the hour', () => {
    const prior = { timestamps: [1000, 2000], appVersion: V };
    const { marker, shouldRelaunch } = evaluateCrashRelaunch(prior, 3000, V);
    expect(shouldRelaunch).toBe(false);
    // still records the crash so the next manual launch enters recovery
    expect(marker.timestamps).toEqual([1000, 2000, 3000]);
  });

  it('drops timestamps older than one hour before counting', () => {
    const now = 10_000_000;
    const stale = now - 3_600_001; // just over an hour ago
    const prior = { timestamps: [stale, stale], appVersion: V };
    const { marker, shouldRelaunch } = evaluateCrashRelaunch(prior, now, V);
    // both stale entries dropped -> this counts as the first fresh crash
    expect(shouldRelaunch).toBe(true);
    expect(marker.timestamps).toEqual([now]);
  });

  it('tolerates a malformed marker (missing timestamps array)', () => {
    const { marker, shouldRelaunch } = evaluateCrashRelaunch({}, 5000, V);
    expect(shouldRelaunch).toBe(true);
    expect(marker.timestamps).toEqual([5000]);
  });
});

describe('evaluateNoSandbox', () => {
  it('does nothing when there is no fallback marker', () => {
    expect(evaluateNoSandbox(null, '0.34.1')).toEqual({
      noSandbox: false,
      clearMarker: false,
    });
  });

  it('applies no-sandbox when the marker version matches', () => {
    expect(evaluateNoSandbox({ appVersion: '0.34.1' }, '0.34.1')).toEqual({
      noSandbox: true,
      clearMarker: false,
    });
  });

  it('clears the marker and retries the sandbox when the version changed', () => {
    expect(evaluateNoSandbox({ appVersion: '0.34.0' }, '0.34.1')).toEqual({
      noSandbox: false,
      clearMarker: true,
    });
  });

  it('ignores a marker with no appVersion string', () => {
    expect(evaluateNoSandbox({}, '0.34.1')).toEqual({
      noSandbox: false,
      clearMarker: false,
    });
  });
});

describe('scanDirectory', () => {
  it('runs icacls on the directory and parses explicit orphan SIDs', () => {
    const execFileSync = vi.fn(() => EXPLICIT_ORPHAN);
    const result = scanDirectory('C:/SokujiSandboxTest', { execFileSync });
    expect(execFileSync).toHaveBeenCalledWith(
      'icacls',
      ['C:/SokujiSandboxTest'],
      expect.objectContaining({ windowsHide: true })
    );
    expect(result).toEqual({
      dir: 'C:/SokujiSandboxTest',
      sids: [ORPHAN_A],
      rawOutput: EXPLICIT_ORPHAN,
      error: null,
    });
  });

  it('decodes a Buffer as latin1 (byte-safe against the OEM code page)', () => {
    // Non-ASCII bytes around an ASCII SID must not corrupt SID extraction.
    const buf = Buffer.from(EXPLICIT_ORPHAN, 'latin1');
    const execFileSync = vi.fn(() => buf);
    const result = scanDirectory('C:/x', { execFileSync });
    expect(result.sids).toEqual([ORPHAN_A]);
    expect(result.error).toBeNull();
  });

  it('returns an error record when icacls throws', () => {
    const execFileSync = vi.fn(() => {
      throw new Error('The system cannot find the path specified.');
    });
    const result = scanDirectory('C:/missing', { execFileSync });
    expect(result.sids).toEqual([]);
    expect(result.rawOutput).toBe('');
    expect(result.error).toMatch(/cannot find the path/);
  });
});

describe('repairDirectory', () => {
  it('removes each orphan SID via icacls /remove "*<SID>"', () => {
    const execFileSync = vi.fn();
    const result = repairDirectory('C:/SokujiSandboxTest', [ORPHAN_A, ORPHAN_B], {
      execFileSync,
    });
    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      'icacls',
      ['C:/SokujiSandboxTest', '/remove', `*${ORPHAN_A}`],
      expect.objectContaining({ windowsHide: true })
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      'icacls',
      ['C:/SokujiSandboxTest', '/remove', `*${ORPHAN_B}`],
      expect.objectContaining({ windowsHide: true })
    );
    expect(result).toEqual({
      dir: 'C:/SokujiSandboxTest',
      removed: [ORPHAN_A, ORPHAN_B],
      errors: [],
    });
  });

  it('records per-SID errors without aborting the rest', () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (args[2] === `*${ORPHAN_A}`) throw new Error('Access is denied.');
    });
    const result = repairDirectory('C:/x', [ORPHAN_A, ORPHAN_B], { execFileSync });
    expect(result.removed).toEqual([ORPHAN_B]);
    expect(result.errors).toEqual([
      { sid: ORPHAN_A, error: expect.stringMatching(/Access is denied/) },
    ]);
  });
});

describe('buildBackupLog', () => {
  it('records the directories, SIDs, raw output and issue URL', () => {
    const scanResults = [
      { dir: 'C:/SokujiSandboxTest', sids: [ORPHAN_A], rawOutput: EXPLICIT_ORPHAN, error: null },
    ];
    const log = buildBackupLog(scanResults, '2026-07-24T04-00-00-000Z');
    expect(log).toContain('2026-07-24T04-00-00-000Z');
    expect(log).toContain('C:/SokujiSandboxTest');
    expect(log).toContain(ORPHAN_A);
    expect(log).toContain('issues/352');
    expect(log).toContain(EXPLICIT_ORPHAN);
  });
});

// ---- Orchestration test helpers (mock electron app/dialog + injected deps) --

const CONFIRMED_DIR = 'C:/Install';

function makeApp(over = {}) {
  const handlers = {};
  return {
    _handlers: handlers,
    getVersion: () => over.version || '0.34.1',
    getPath: (k) =>
      k === 'exe'
        ? over.exe || 'C:/Install/sokuji.exe'
        : k === 'userData'
          ? over.userData || 'C:/UD'
          : '',
    commandLine: { appendSwitch: vi.fn() },
    on: vi.fn((evt, cb) => {
      handlers[evt] = cb;
    }),
    relaunch: vi.fn(),
    exit: vi.fn(),
  };
}

function makeDeps(over = {}) {
  return {
    platform: 'win32',
    fs: over.fs || {
      readFileSync: vi.fn(() => {
        throw new Error('ENOENT');
      }),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    },
    execFileSync: over.execFileSync || vi.fn(),
    now: over.now || (() => 0),
    env: over.env || { LOCALAPPDATA: 'C:/Users/j/AppData/Local', USERPROFILE: 'C:/Users/j' },
    log: () => {},
  };
}

describe('getScanDirectories', () => {
  it('returns the exe dir, LOCALAPPDATA and USERPROFILE, deduped', () => {
    const app = makeApp();
    const dirs = getScanDirectories(app, {
      LOCALAPPDATA: 'C:/Users/j/AppData/Local',
      USERPROFILE: 'C:/Users/j',
    });
    expect(dirs).toEqual(['C:/Install', 'C:/Users/j/AppData/Local', 'C:/Users/j']);
  });

  it('skips missing env vars and dedupes overlaps', () => {
    const app = makeApp({ exe: 'C:/Users/j/sokuji.exe' });
    const dirs = getScanDirectories(app, { USERPROFILE: 'C:/Users/j' });
    expect(dirs).toEqual(['C:/Users/j']);
  });
});

describe('applyNoSandboxFlag', () => {
  it('is a no-op on non-win32', () => {
    const app = makeApp();
    const deps = makeDeps();
    deps.platform = 'linux';
    expect(applyNoSandboxFlag(app, { deps, userDataDir: 'C:/UD' })).toBe(false);
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  it('appends --no-sandbox when the marker version matches', () => {
    const app = makeApp();
    const deps = makeDeps({
      fs: {
        readFileSync: vi.fn(() => JSON.stringify({ appVersion: '0.34.1' })),
        writeFileSync: vi.fn(),
        unlinkSync: vi.fn(),
      },
    });
    expect(applyNoSandboxFlag(app, { deps, userDataDir: 'C:/UD' })).toBe(true);
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('no-sandbox');
    expect(deps.fs.unlinkSync).not.toHaveBeenCalled();
  });

  it('clears a stale marker and keeps the sandbox when the version changed', () => {
    const app = makeApp({ version: '0.34.1' });
    const deps = makeDeps({
      fs: {
        readFileSync: vi.fn(() => JSON.stringify({ appVersion: '0.34.0' })),
        writeFileSync: vi.fn(),
        unlinkSync: vi.fn(),
      },
    });
    expect(applyNoSandboxFlag(app, { deps, userDataDir: 'C:/UD' })).toBe(false);
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
    expect(deps.fs.unlinkSync).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is no marker', () => {
    const app = makeApp();
    const deps = makeDeps();
    expect(applyNoSandboxFlag(app, { deps, userDataDir: 'C:/UD' })).toBe(false);
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
    expect(deps.fs.unlinkSync).not.toHaveBeenCalled();
  });
});

describe('registerCrashDetection', () => {
  const gpuCrash = { type: 'GPU', reason: 'crashed', exitCode: -2147483645 };

  it('does not register the listener on non-win32', () => {
    const app = makeApp();
    const deps = makeDeps();
    deps.platform = 'darwin';
    registerCrashDetection(app, { deps, userDataDir: 'C:/UD' });
    expect(app.on).not.toHaveBeenCalled();
  });

  it('writes a crash marker and relaunches on the first GPU sandbox crash', () => {
    const app = makeApp();
    const deps = makeDeps();
    registerCrashDetection(app, { deps, userDataDir: 'C:/UD' });
    expect(app.on).toHaveBeenCalledWith('child-process-gone', expect.any(Function));
    app._handlers['child-process-gone']({}, gpuCrash);
    expect(deps.fs.writeFileSync).toHaveBeenCalledTimes(1);
    const json = deps.fs.writeFileSync.mock.calls[0][1];
    expect(JSON.parse(json).timestamps).toHaveLength(1);
    expect(app.relaunch).toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalledWith(0);
  });

  it('ignores unrelated child-process-gone events', () => {
    const app = makeApp();
    const deps = makeDeps();
    registerCrashDetection(app, { deps, userDataDir: 'C:/UD' });
    app._handlers['child-process-gone'](
      {},
      { type: 'Utility', reason: 'crashed', exitCode: -2147483645 }
    );
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled();
    expect(app.relaunch).not.toHaveBeenCalled();
  });

  it('records the crash but does NOT relaunch once the hourly cap is hit', () => {
    const app = makeApp();
    const deps = makeDeps({
      now: () => 1_000_000,
      fs: {
        readFileSync: vi.fn(() =>
          JSON.stringify({ timestamps: [999_000, 999_500], appVersion: '0.34.1' })
        ),
        writeFileSync: vi.fn(),
        unlinkSync: vi.fn(),
      },
    });
    registerCrashDetection(app, { deps, userDataDir: 'C:/UD' });
    app._handlers['child-process-gone']({}, gpuCrash);
    expect(deps.fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(app.relaunch).not.toHaveBeenCalled();
    expect(app.exit).not.toHaveBeenCalled();
  });
});

describe('handleRecoveryMode', () => {
  function crashMarkerFs(over = {}) {
    return {
      readFileSync: vi.fn(() => JSON.stringify({ timestamps: [0], appVersion: '0.34.1' })),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
      ...over,
    };
  }

  it('proceeds normally on non-win32', () => {
    const app = makeApp();
    const dialog = { showMessageBoxSync: vi.fn() };
    const deps = makeDeps();
    deps.platform = 'linux';
    expect(handleRecoveryMode(app, dialog, { deps, userDataDir: 'C:/UD' })).toBe(true);
    expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
  });

  it('proceeds normally when there is no crash marker', () => {
    const app = makeApp();
    const dialog = { showMessageBoxSync: vi.fn() };
    const deps = makeDeps(); // default fs.readFileSync throws
    expect(handleRecoveryMode(app, dialog, { deps, userDataDir: 'C:/UD' })).toBe(true);
    expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
  });

  it('confirmed + Repair success: removes ACE, deletes marker, relaunches', () => {
    const app = makeApp();
    const dialog = { showMessageBoxSync: vi.fn(() => 0) }; // Repair
    const repaired = new Set();
    const execFileSync = vi.fn((cmd, args) => {
      const dir = args[0];
      if (args.includes('/remove')) {
        repaired.add(dir);
        return;
      }
      if (dir === CONFIRMED_DIR && !repaired.has(dir)) return EXPLICIT_ORPHAN;
      return CLEAN;
    });
    const fs = crashMarkerFs();
    const deps = makeDeps({ execFileSync, fs });
    const proceed = handleRecoveryMode(app, dialog, { deps, userDataDir: 'C:/UD' });
    expect(dialog.showMessageBoxSync.mock.calls[0][0].buttons[0]).toMatch(/Repair/);
    expect(execFileSync).toHaveBeenCalledWith(
      'icacls',
      [CONFIRMED_DIR, '/remove', `*${ORPHAN_A}`],
      expect.objectContaining({ windowsHide: true })
    );
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(fs.unlinkSync).toHaveBeenCalled();
    expect(app.relaunch).toHaveBeenCalled();
    expect(proceed).toBe(false);
  });

  it('confirmed + Continue without sandbox: writes fallback marker, relaunches', () => {
    const app = makeApp();
    const dialog = { showMessageBoxSync: vi.fn(() => 1) }; // Continue
    const execFileSync = vi.fn((cmd, args) =>
      args[0] === CONFIRMED_DIR ? EXPLICIT_ORPHAN : CLEAN
    );
    const fs = crashMarkerFs();
    const deps = makeDeps({ execFileSync, fs });
    const proceed = handleRecoveryMode(app, dialog, { deps, userDataDir: 'C:/UD' });
    const fallbackWrite = fs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes(FALLBACK_MARKER)
    );
    expect(fallbackWrite).toBeTruthy();
    expect(JSON.parse(fallbackWrite[1])).toEqual({ appVersion: '0.34.1' });
    expect(app.relaunch).toHaveBeenCalled();
    expect(proceed).toBe(false);
  });

  it('confirmed + Quit: deletes marker, exits, no fallback written', () => {
    const app = makeApp();
    const dialog = { showMessageBoxSync: vi.fn(() => 2) }; // Quit
    const execFileSync = vi.fn((cmd, args) =>
      args[0] === CONFIRMED_DIR ? EXPLICIT_ORPHAN : CLEAN
    );
    const fs = crashMarkerFs();
    const deps = makeDeps({ execFileSync, fs });
    const proceed = handleRecoveryMode(app, dialog, { deps, userDataDir: 'C:/UD' });
    const fallbackWrite = fs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes(FALLBACK_MARKER)
    );
    expect(fallbackWrite).toBeFalsy();
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(app.relaunch).not.toHaveBeenCalled();
    expect(proceed).toBe(false);
  });

  it('confirmed + Repair fails: shows fallback dialog, then no-sandbox continue', () => {
    const app = makeApp();
    const dialog = { showMessageBoxSync: vi.fn() };
    dialog.showMessageBoxSync.mockReturnValueOnce(0); // Repair
    dialog.showMessageBoxSync.mockReturnValueOnce(0); // Continue without sandbox
    const execFileSync = vi.fn((cmd, args) => {
      if (args.includes('/remove')) throw new Error('Access is denied.');
      return args[0] === CONFIRMED_DIR ? EXPLICIT_ORPHAN : CLEAN;
    });
    const fs = crashMarkerFs();
    const deps = makeDeps({ execFileSync, fs });
    const proceed = handleRecoveryMode(app, dialog, { deps, userDataDir: 'C:/UD' });
    expect(dialog.showMessageBoxSync).toHaveBeenCalledTimes(2);
    const fallbackWrite = fs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes(FALLBACK_MARKER)
    );
    expect(fallbackWrite).toBeTruthy();
    expect(app.relaunch).toHaveBeenCalled();
    expect(proceed).toBe(false);
  });

  it('unconfirmed (clean scan): offers no Repair button', () => {
    const app = makeApp();
    const dialog = { showMessageBoxSync: vi.fn(() => 1) }; // Quit (index 1 of 2)
    const execFileSync = vi.fn(() => CLEAN);
    const fs = crashMarkerFs();
    const deps = makeDeps({ execFileSync, fs });
    const proceed = handleRecoveryMode(app, dialog, { deps, userDataDir: 'C:/UD' });
    const buttons = dialog.showMessageBoxSync.mock.calls[0][0].buttons;
    expect(buttons.some((b) => /Repair/.test(b))).toBe(false);
    expect(buttons).toHaveLength(2);
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(proceed).toBe(false);
  });

  it('unconfirmed + Continue without sandbox: writes fallback, relaunches', () => {
    const app = makeApp();
    const dialog = { showMessageBoxSync: vi.fn(() => 0) }; // Continue (index 0 of 2)
    const execFileSync = vi.fn(() => CLEAN);
    const fs = crashMarkerFs();
    const deps = makeDeps({ execFileSync, fs });
    const proceed = handleRecoveryMode(app, dialog, { deps, userDataDir: 'C:/UD' });
    const fallbackWrite = fs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes(FALLBACK_MARKER)
    );
    expect(fallbackWrite).toBeTruthy();
    expect(app.relaunch).toHaveBeenCalled();
    expect(proceed).toBe(false);
  });
});

describe('beforeExit cleanup hook (sidecar teardown before exit)', () => {
  const gpuCrash = { type: 'GPU', reason: 'crashed', exitCode: -2147483645 };

  it('runs beforeExit before app.exit on the passive crash relaunch', () => {
    const app = makeApp();
    const order = [];
    app.relaunch = vi.fn(() => order.push('relaunch'));
    app.exit = vi.fn(() => order.push('exit'));
    const beforeExit = vi.fn(() => order.push('cleanup'));
    const deps = makeDeps();
    deps.beforeExit = beforeExit;
    registerCrashDetection(app, { deps, userDataDir: 'C:/UD' });
    app._handlers['child-process-gone']({}, gpuCrash);
    expect(beforeExit).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['cleanup', 'relaunch', 'exit']);
  });

  it('runs beforeExit before app.exit on the recovery Quit path', () => {
    const app = makeApp();
    const order = [];
    app.exit = vi.fn(() => order.push('exit'));
    const beforeExit = vi.fn(() => order.push('cleanup'));
    const dialog = { showMessageBoxSync: vi.fn(() => 2) }; // Quit (confirmed)
    const execFileSync = vi.fn((cmd, args) =>
      args[0] === CONFIRMED_DIR ? EXPLICIT_ORPHAN : CLEAN
    );
    const fs = {
      readFileSync: vi.fn(() => JSON.stringify({ timestamps: [0], appVersion: '0.34.1' })),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const deps = makeDeps({ execFileSync, fs });
    deps.beforeExit = beforeExit;
    handleRecoveryMode(app, dialog, { deps, userDataDir: 'C:/UD' });
    expect(order).toEqual(['cleanup', 'exit']);
  });

  it('runs beforeExit before relaunch on the continue-without-sandbox path', () => {
    const app = makeApp();
    const order = [];
    app.relaunch = vi.fn(() => order.push('relaunch'));
    app.exit = vi.fn(() => order.push('exit'));
    const beforeExit = vi.fn(() => order.push('cleanup'));
    const dialog = { showMessageBoxSync: vi.fn(() => 0) }; // Continue (unconfirmed)
    const execFileSync = vi.fn(() => CLEAN);
    const fs = {
      readFileSync: vi.fn(() => JSON.stringify({ timestamps: [0], appVersion: '0.34.1' })),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const deps = makeDeps({ execFileSync, fs });
    deps.beforeExit = beforeExit;
    handleRecoveryMode(app, dialog, { deps, userDataDir: 'C:/UD' });
    expect(order).toEqual(['cleanup', 'relaunch', 'exit']);
  });
});

describe('repair-failed dialog does not overclaim a backup', () => {
  it('omits the "saved to" line when the backup write failed', () => {
    const app = makeApp();
    const dialog = { showMessageBoxSync: vi.fn() };
    dialog.showMessageBoxSync.mockReturnValueOnce(0); // Repair
    dialog.showMessageBoxSync.mockReturnValueOnce(1); // Quit at repair-failed dialog
    const execFileSync = vi.fn((cmd, args) => {
      if (args.includes('/remove')) throw new Error('Access is denied.');
      return args[0] === CONFIRMED_DIR ? EXPLICIT_ORPHAN : CLEAN;
    });
    const fs = {
      readFileSync: vi.fn(() => JSON.stringify({ timestamps: [0], appVersion: '0.34.1' })),
      writeFileSync: vi.fn(() => {
        throw new Error('disk full');
      }), // backup write fails
      unlinkSync: vi.fn(),
    };
    const deps = makeDeps({ execFileSync, fs });
    handleRecoveryMode(app, dialog, { deps, userDataDir: 'C:/UD' });
    const failDetail = dialog.showMessageBoxSync.mock.calls[1][0].detail;
    expect(failDetail).not.toMatch(/was saved to/);
  });

  it('still reports the backup path when the backup write succeeded', () => {
    const app = makeApp();
    const dialog = { showMessageBoxSync: vi.fn() };
    dialog.showMessageBoxSync.mockReturnValueOnce(0); // Repair
    dialog.showMessageBoxSync.mockReturnValueOnce(1); // Quit at repair-failed dialog
    const execFileSync = vi.fn((cmd, args) => {
      if (args.includes('/remove')) throw new Error('Access is denied.');
      return args[0] === CONFIRMED_DIR ? EXPLICIT_ORPHAN : CLEAN;
    });
    const fs = {
      readFileSync: vi.fn(() => JSON.stringify({ timestamps: [0], appVersion: '0.34.1' })),
      writeFileSync: vi.fn(), // backup write succeeds
      unlinkSync: vi.fn(),
    };
    const deps = makeDeps({ execFileSync, fs });
    handleRecoveryMode(app, dialog, { deps, userDataDir: 'C:/UD' });
    const failDetail = dialog.showMessageBoxSync.mock.calls[1][0].detail;
    expect(failDetail).toMatch(/was saved to/);
  });
});
