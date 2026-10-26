// electron/update-install-windows.test.js
//
// The Windows update used to open Setup.exe and quit the app 500 ms later.
// Squirrel's --install deletes the whole install directory before it writes
// the new version ("burning it to the ground"); with the old app still
// exiting it hit a locked sokuji.exe, crashed, and left the app uninstalled
// (Squirrel-Install.log, 2026-10-27 02:34 JST). These pin the fallback that
// replaces it: verify the download; wait, bounded, for every process under
// the install root to be gone; run the installer only then, never on a timeout.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  verifyDownloadedInstaller,
  installerLaunchCommand,
  staleInstallers,
  isInstallerName,
} from './update-install-windows.js';

let dir;
const bytes = Buffer.from('not really an installer, but bytes are bytes');
const sha512 = createHash('sha512').update(bytes).digest('base64');
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sokuji-update-'));
  writeFileSync(join(dir, 'Sokuji-0.46.4.Setup.exe'), bytes);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('verifyDownloadedInstaller', () => {
  it('accepts a file whose size and sha512 match latest.yml', async () => {
    const r = await verifyDownloadedInstaller(join(dir, 'Sokuji-0.46.4.Setup.exe'), { size: bytes.length, sha512 });
    expect(r).toEqual({ ok: true });
  });

  it('rejects a truncated file by size before hashing', async () => {
    const r = await verifyDownloadedInstaller(join(dir, 'Sokuji-0.46.4.Setup.exe'), { size: bytes.length + 1, sha512 });
    expect(r).toEqual({ ok: false, reason: `size ${bytes.length} != expected ${bytes.length + 1}` });
  });

  it('rejects a file whose sha512 differs', async () => {
    const r = await verifyDownloadedInstaller(join(dir, 'Sokuji-0.46.4.Setup.exe'), { size: bytes.length, sha512: 'AAAA' });
    expect(r).toEqual({ ok: false, reason: 'sha512 mismatch' });
  });

  it('fails closed when latest.yml carried neither a size nor a hash', async () => {
    const r = await verifyDownloadedInstaller(join(dir, 'Sokuji-0.46.4.Setup.exe'), {});
    expect(r).toEqual({ ok: false, reason: 'latest.yml names no size or sha512 for this file' });
  });
});

describe('installerLaunchCommand', () => {
  const cmd = installerLaunchCommand({
    installerPath: "C:\\Users\\jiang\\AppData\\Local\\Temp\\Sokuji-0.46.4.Setup.exe",
    pid: 4242,
    installRoot: "C:\\Users\\jiang\\AppData\\Local\\Sokuji",
    systemRoot: 'C:\\WINDOWS',
  });
  const script = cmd.args[cmd.args.length - 1];

  it('runs the system PowerShell, hidden, with a -Command script', () => {
    expect(cmd.file).toBe('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(cmd.args.slice(0, -1)).toEqual(['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command']);
  });

  it('is one statement per line, so a reader (and PowerShell) can follow it', () => {
    const lines = script.split('\n');
    expect(lines.length).toBeGreaterThan(8);
    expect(lines.some((l) => l.includes('; '))).toBe(false);
    expect(lines[0]).toBe('Wait-Process -Id 4242 -Timeout 120 -ErrorAction SilentlyContinue');
    expect(lines[lines.length - 1]).toBe("Start-Process -FilePath 'C:\\Users\\jiang\\AppData\\Local\\Temp\\Sokuji-0.46.4.Setup.exe'");
  });

  it('waits for this process with a bound, and gives up if it is still there', () => {
    expect(script).toContain('Wait-Process -Id 4242 -Timeout 120 -ErrorAction SilentlyContinue');
    expect(script).toMatch(/if \(Get-Process -Id 4242 -ErrorAction SilentlyContinue\) \{[^}]*exit 1/);
  });

  it('then waits until nothing under the install root runs — the audio helper included', () => {
    expect(script).toContain("$root = 'C:\\Users\\jiang\\AppData\\Local\\Sokuji\\'");
    expect(script).toContain("$pattern = 'C:\\Users\\jiang\\AppData\\Local\\Sokuji\\*'");
    expect(script).toContain('Get-Process | Where-Object { $_.Path -and ($_.Path -like $pattern) }');
    expect(script).toMatch(/-lt 60/);
  });

  it('never starts the installer while something is still running: it logs and exits', () => {
    const giveUp = script.indexOf('if ($left) {');
    const start = script.indexOf('Start-Process');
    expect(giveUp).toBeGreaterThan(-1);
    expect(giveUp).toBeLessThan(start);
    expect(script.slice(giveUp, start)).toContain('exit 1');
    expect(script).toContain("Add-Content -Path 'C:\\Users\\jiang\\AppData\\Local\\Temp\\Sokuji-0.46.4.Setup.exe.launch.log'");
  });

  it('starts the installer last, quoted for PowerShell', () => {
    expect(script.trimEnd().endsWith("Start-Process -FilePath 'C:\\Users\\jiang\\AppData\\Local\\Temp\\Sokuji-0.46.4.Setup.exe'")).toBe(true);
  });

  it('escapes a single quote in a path and does not double a trailing separator', () => {
    const c = installerLaunchCommand({ installerPath: "C:\\it's\\Setup.exe", pid: 1, installRoot: "C:\\o'k\\", systemRoot: 'C:\\WINDOWS' });
    const s = c.args[c.args.length - 1];
    expect(s).toContain("'C:\\it''s\\Setup.exe'");
    expect(s).toContain("$root = 'C:\\o''k\\'");
  });

  it('escapes wildcard characters in the install root, so a bracketed user name still matches its own processes', () => {
    // `-like` reads [ ] * ? as wildcards: unescaped, 'C:\Users\jiang[1]\…' matches nothing,
    // $left stays empty, and the installer would run over a live app.
    const c = installerLaunchCommand({ installerPath: 'C:\\t\\Setup.exe', pid: 1, installRoot: 'C:\\Users\\jiang[1]\\AppData\\Local\\Sokuji', systemRoot: 'C:\\WINDOWS' });
    const s = c.args[c.args.length - 1];
    expect(s).toContain("$pattern = 'C:\\Users\\jiang`[1`]\\AppData\\Local\\Sokuji\\*'");
    expect(s).toContain('$_.Path -like $pattern');
  });
});

describe('isInstallerName', () => {
  it('matches only Sokuji Setup executables', () => {
    expect(isInstallerName('Sokuji-0.46.4.Setup.exe')).toBe(true);
    expect(isInstallerName('sokuji-0.46.4.setup.EXE')).toBe(true);
    expect(isInstallerName('Sokuji-0.46.4-full.nupkg')).toBe(false);
    expect(isInstallerName('Other-1.0.Setup.exe')).toBe(false);
  });
});

describe('staleInstallers', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 1_800_000_000_000;
  it('names Sokuji installers in the temp directory older than a day, and nothing else', () => {
    const entries = [
      { name: 'Sokuji-0.46.1.Setup.exe', mtimeMs: now - 3 * day },
      { name: 'Sokuji-0.46.4.Setup.exe', mtimeMs: now - 60_000 },
      { name: 'other.txt', mtimeMs: now - 9 * day },
      { name: 'Sokuji-0.32.1.Setup.exe', mtimeMs: now - 100 * day },
    ];
    expect(staleInstallers(entries, { now, maxAgeMs: day })).toEqual(['Sokuji-0.46.1.Setup.exe', 'Sokuji-0.32.1.Setup.exe']);
  });
});
