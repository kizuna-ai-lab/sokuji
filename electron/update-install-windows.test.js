// electron/update-install-windows.test.js
//
// The Windows update used to open Setup.exe and quit the app 500 ms later.
// Squirrel's --install deletes the whole install directory before it writes
// the new version ("burning it to the ground"); with the old app still
// exiting it hit a locked sokuji.exe, crashed, and left the app uninstalled
// (Squirrel-Install.log, 2026-10-27 02:34 JST). These pin the replacement:
// verify the download, wait for every Sokuji process to be gone, only then
// run the installer.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  verifyDownloadedInstaller,
  installerLaunchCommand,
  staleInstallers,
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

  it('passes when latest.yml carried no size or hash (older releases)', async () => {
    const r = await verifyDownloadedInstaller(join(dir, 'Sokuji-0.46.4.Setup.exe'), {});
    expect(r).toEqual({ ok: true });
  });
});

describe('installerLaunchCommand', () => {
  const cmd = installerLaunchCommand({
    installerPath: "C:\\Users\\jiang\\AppData\\Local\\Temp\\Sokuji-0.46.4.Setup.exe",
    pid: 4242,
    installRoot: "C:\\Users\\jiang\\AppData\\Local\\Sokuji",
    exeName: 'sokuji.exe',
  });

  it('runs a detached PowerShell that waits for this process first', () => {
    expect(cmd.file).toBe('powershell.exe');
    expect(cmd.args.slice(0, 4)).toEqual(['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden']);
    const script = cmd.args[cmd.args.length - 1];
    expect(script).toContain('Wait-Process -Id 4242');
  });

  it('then waits until no sokuji.exe from the install root is left, with a bound', () => {
    const script = cmd.args[cmd.args.length - 1];
    expect(script).toContain("'sokuji'");
    expect(script).toContain("C:\\Users\\jiang\\AppData\\Local\\Sokuji");
    expect(script).toMatch(/-lt 60/);
  });

  it('starts the installer last, quoted for PowerShell', () => {
    const script = cmd.args[cmd.args.length - 1];
    expect(script.trimEnd().endsWith("Start-Process -FilePath 'C:\\Users\\jiang\\AppData\\Local\\Temp\\Sokuji-0.46.4.Setup.exe'")).toBe(true);
  });

  it('escapes a single quote in a path', () => {
    const c = installerLaunchCommand({ installerPath: "C:\\it's\\Setup.exe", pid: 1, installRoot: "C:\\o'k", exeName: 'sokuji.exe' });
    const script = c.args[c.args.length - 1];
    expect(script).toContain("'C:\\it''s\\Setup.exe'");
    expect(script).toContain("'C:\\o''k");
  });
});

describe('staleInstallers', () => {
  it('names every earlier Sokuji Setup.exe in the temp directory but the one just downloaded', () => {
    const names = ['Sokuji-0.46.1.Setup.exe', 'Sokuji-0.46.4.Setup.exe', 'other.txt', 'Sokuji-0.32.1.Setup.exe'];
    expect(staleInstallers(names, 'Sokuji-0.46.4.Setup.exe')).toEqual(['Sokuji-0.46.1.Setup.exe', 'Sokuji-0.32.1.Setup.exe']);
  });
});
