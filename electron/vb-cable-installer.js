// Installs VB-CABLE for the website's build, behind the renderer's prompt
// (spec 2026-10-17 §2). No native dialogs: the result is what the prompt draws.
// The Microsoft Store's build never reaches this (main.js 'install-vbcable').
//
// The user still approves the administrator prompt and clicks "Install Driver"
// in VB-Audio's own window; Sokuji only fetches the pack and starts its setup.
const path = require('path').win32;
const fsPromises = require('fs').promises;
const { execFile } = require('child_process');

const VB_CABLE_ZIP_URL = 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip';
const SETUP_EXE = 'VBCABLE_Setup_x64.exe';
// ERROR_CANCELLED: the administrator prompt was declined. Matched by code,
// because Start-Process words the message in the system's language.
const UAC_CANCELLED_EXIT = 1223;

/** A PowerShell single-quoted literal: only ' needs escaping, as ''. */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Run one PowerShell command, arguments passed as an array so no shell parses them. */
function runPowerShell(script, execFileImpl = execFile) {
  return new Promise((resolve, reject) => {
    execFileImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = String(stderr || '');
        reject(error);
      } else {
        resolve(String(stdout || ''));
      }
    });
  });
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'cancelled' | 'download-failed' | 'not-detected' | 'failed' }>}
 */
async function installVBCable({
  tempRoot = require('electron').app.getPath('temp'),
  fetchImpl = fetch,
  fs = fsPromises,
  powershell = runPowerShell,
  isInstalled = () => require('./windows-audio-utils').isVBCableInstalled(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  detectAttempts = 5,
  detectIntervalMs = 2000,
} = {}) {
  if (await isInstalled()) return { ok: true };

  const dir = path.join(tempRoot, 'sokuji-vbcable');
  try {
    await fs.mkdir(dir, { recursive: true });
    const zip = path.join(dir, 'vbcable.zip');
    try {
      const response = await fetchImpl(VB_CABLE_ZIP_URL, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await fs.writeFile(zip, Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error('[Sokuji] [VB-CABLE Installer] Download failed:', error?.message);
      return { ok: false, reason: 'download-failed' };
    }

    await powershell(`Expand-Archive -LiteralPath ${psQuote(zip)} -DestinationPath ${psQuote(dir)} -Force`);

    const setup = path.join(dir, SETUP_EXE);
    try {
      await powershell(
        `try { Start-Process -FilePath ${psQuote(setup)} -WorkingDirectory ${psQuote(dir)} -Verb RunAs -Wait -ErrorAction Stop } `
        + `catch { $e = $_.Exception; while ($e) { if ($e.NativeErrorCode -eq ${UAC_CANCELLED_EXIT}) { exit ${UAC_CANCELLED_EXIT} }; $e = $e.InnerException }; throw }`,
      );
    } catch (error) {
      if (error?.code === UAC_CANCELLED_EXIT) return { ok: false, reason: 'cancelled' };
      throw error;
    }

    for (let attempt = 0; attempt < detectAttempts; attempt++) {
      if (attempt > 0) await sleep(detectIntervalMs);
      if (await isInstalled()) return { ok: true };
    }
    return { ok: false, reason: 'not-detected' };
  } catch (error) {
    console.error('[Sokuji] [VB-CABLE Installer] Installation failed:', error?.message, error?.stderr || '');
    return { ok: false, reason: 'failed' };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { installVBCable, psQuote, runPowerShell, VB_CABLE_ZIP_URL, SETUP_EXE, UAC_CANCELLED_EXIT };
