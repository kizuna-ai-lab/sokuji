// electron/vb-cable-installer.test.js
import { describe, it, expect, vi } from 'vitest';
import { installVBCable, psQuote, runPowerShell, VB_CABLE_ZIP_URL, UAC_CANCELLED_EXIT } from './vb-cable-installer.js';

const TEMP = 'C:\\Users\\ann\\AppData\\Local\\Temp';

/** Everything installVBCable reaches outside itself, faked. `installed` answers successive isInstalled() calls. */
function deps({ installed = [false, true], response, powershell, tempRoot = TEMP } = {}) {
  let i = 0;
  const scripts = [];
  return {
    tempRoot,
    fetchImpl: vi.fn(async () => response ?? new Response(new Uint8Array([0x50, 0x4b]), { status: 200 })),
    fs: { mkdir: vi.fn(async () => {}), writeFile: vi.fn(async () => {}), rm: vi.fn(async () => {}) },
    powershell: powershell ?? vi.fn(async (script) => { scripts.push(script); return ''; }),
    isInstalled: vi.fn(async () => installed[Math.min(i++, installed.length - 1)]),
    sleep: vi.fn(async () => {}),
    detectAttempts: 3,
    scripts,
  };
}

describe('psQuote', () => {
  it('makes a single-quoted PowerShell literal, doubling quotes inside', () => {
    expect(psQuote("C:\\Users\\O'Brien\\x.zip")).toBe("'C:\\Users\\O''Brien\\x.zip'");
  });

  it('doubles the typographic single quotes too, which PowerShell also reads as quote marks', () => {
    for (const q of ['\u2018', '\u2019', '\u201A', '\u201B']) {
      expect(psQuote(`C:\\Users\\D${q}Angelo`)).toBe(`'C:\\Users\\D${q}${q}Angelo'`);
    }
  });
});

describe('runPowerShell', () => {
  it('runs powershell.exe with the script as one argument, hidden, never through a shell', async () => {
    const execFileImpl = vi.fn((_file, _args, _opts, cb) => cb(null, 'out', ''));
    await expect(runPowerShell('Get-Date', execFileImpl)).resolves.toBe('out');
    expect(execFileImpl).toHaveBeenCalledWith('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Date'], { windowsHide: true }, expect.any(Function));
  });
});

describe('installVBCable', () => {
  it('does nothing when VB-CABLE is already there', async () => {
    const d = deps({ installed: [true] });
    await expect(installVBCable(d)).resolves.toEqual({ ok: true });
    expect(d.fetchImpl).not.toHaveBeenCalled();
    expect(d.powershell).not.toHaveBeenCalled();
  });

  it('downloads, extracts, runs the setup elevated and waits for the driver', async () => {
    const d = deps({ installed: [false, false, true] });
    await expect(installVBCable(d)).resolves.toEqual({ ok: true });
    expect(d.fetchImpl).toHaveBeenCalledWith(VB_CABLE_ZIP_URL, { redirect: 'follow' });
    const dir = `${TEMP}\\sokuji-vbcable`;
    expect(d.scripts[0]).toBe(`Expand-Archive -LiteralPath '${dir}\\vbcable.zip' -DestinationPath '${dir}' -Force`);
    const start = d.scripts[1];
    expect(start).toContain(`$psi.FileName = '${dir}\\VBCABLE_Setup_x64.exe'`);
    expect(start).toContain(`$psi.WorkingDirectory = '${dir}'`);
    expect(start).toContain("$psi.Verb = 'runas'");
    expect(start).toContain('$psi.UseShellExecute = $true');
    expect(start).toContain('[System.Diagnostics.Process]::Start($psi)');
    expect(start).toContain('WaitForExit()');
    expect(start).toContain(`exit ${UAC_CANCELLED_EXIT}`);
    // Start-Process rethrows a declined prompt as a bare InvalidOperationException,
    // losing the Win32 code; Process.Start keeps it as the InnerException.
    expect(start).not.toContain('Start-Process');
    expect(d.fs.rm).toHaveBeenCalledWith(dir, { recursive: true, force: true });
  });

  it('quotes a temp path that holds an apostrophe', async () => {
    const d = deps({ tempRoot: "C:\\Users\\O'Brien\\AppData\\Local\\Temp" });
    await installVBCable(d);
    expect(d.scripts[0]).toContain("-LiteralPath 'C:\\Users\\O''Brien\\AppData\\Local\\Temp\\sokuji-vbcable\\vbcable.zip'");
  });

  it('quotes a temp path that holds a typographic apostrophe', async () => {
    const d = deps({ tempRoot: 'C:\\Users\\D\u2019Angelo\\AppData\\Local\\Temp' });
    await installVBCable(d);
    expect(d.scripts[0]).toContain("-LiteralPath 'C:\\Users\\D\u2019\u2019Angelo\\AppData\\Local\\Temp\\sokuji-vbcable\\vbcable.zip'");
    expect(d.scripts[1]).toContain("$psi.FileName = 'C:\\Users\\D\u2019\u2019Angelo\\AppData\\Local\\Temp\\sokuji-vbcable\\VBCABLE_Setup_x64.exe'");
  });

  it('reads a declined administrator prompt as cancelled, by exit code, in any Windows language', async () => {
    const powershell = vi.fn(async (script) => {
      if (script.includes('Process]::Start(')) throw Object.assign(new Error('Command failed'), { code: UAC_CANCELLED_EXIT, stderr: 'この操作はユーザーによって取り消されました。' });
      return '';
    });
    const d = deps({ powershell });
    await expect(installVBCable(d)).resolves.toEqual({ ok: false, reason: 'cancelled' });
    expect(d.fs.rm).toHaveBeenCalled();
  });

  it('reports a download that did not answer 200 without running anything', async () => {
    const d = deps({ response: new Response('nope', { status: 404 }) });
    await expect(installVBCable(d)).resolves.toEqual({ ok: false, reason: 'download-failed' });
    expect(d.powershell).not.toHaveBeenCalled();
    expect(d.fs.rm).toHaveBeenCalled();
  });

  it('reports not-detected when the setup closed but the driver never appeared', async () => {
    const d = deps({ installed: [false] });
    await expect(installVBCable(d)).resolves.toEqual({ ok: false, reason: 'not-detected' });
    expect(d.isInstalled).toHaveBeenCalledTimes(1 + 3);
    expect(d.sleep).toHaveBeenCalledTimes(2);
  });

  it('reports failed for any other error, such as an archive that will not extract', async () => {
    const powershell = vi.fn(async () => { throw Object.assign(new Error('Command failed'), { code: 1 }); });
    await expect(installVBCable(deps({ powershell }))).resolves.toEqual({ ok: false, reason: 'failed' });
  });
});
