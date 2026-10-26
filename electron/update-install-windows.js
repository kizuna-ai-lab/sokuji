// electron/update-install-windows.js
//
// The Windows update installs by running the full Squirrel Setup.exe. Its
// --install step deletes the whole install directory before writing the new
// version ("Install path … already exists, burning it to the ground"), and a
// file still held by the exiting app makes it crash with the directory
// half-deleted — the app is then simply gone (Squirrel-Install.log,
// 2026-10-27 02:34 JST, `Access to the path '…\app-0.46.1\sokuji.exe' is
// denied`). So the installer must not start until every Sokuji process has
// exited, and a damaged download must never be started at all.
//
// Pure helpers, no Electron: update-manager.js wires them in.
const { createHash } = require('crypto');
const { createReadStream, statSync } = require('fs');

/**
 * Check a downloaded installer against what latest.yml announced. Size first
 * (cheap, and the usual failure: a truncated download), then the base64
 * sha512. A field latest.yml did not carry is not checked.
 * @param {string} filePath
 * @param {{ size?: number, sha512?: string }} expected
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
async function verifyDownloadedInstaller(filePath, expected = {}) {
  if (typeof expected.size === 'number') {
    const actual = statSync(filePath).size;
    if (actual !== expected.size) return { ok: false, reason: `size ${actual} != expected ${expected.size}` };
  }
  if (typeof expected.sha512 === 'string' && expected.sha512) {
    const digest = await new Promise((resolve, reject) => {
      const hash = createHash('sha512');
      createReadStream(filePath)
        .on('data', (chunk) => hash.update(chunk))
        .on('error', reject)
        .on('end', () => resolve(hash.digest('base64')));
    });
    if (digest !== expected.sha512) return { ok: false, reason: 'sha512 mismatch' };
  }
  return { ok: true };
}

/** A PowerShell single-quoted literal: only the quote itself needs doubling. */
function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/**
 * The detached process that installs the update once this app is gone:
 * waits for this process id, then until no process named like the app whose
 * executable lives under the install root remains (bounded, so a stuck
 * helper cannot block the update forever), then starts the installer.
 * @param {{ installerPath: string, pid: number, installRoot: string, exeName: string }} o
 * @returns {{ file: string, args: string[] }}
 */
function installerLaunchCommand({ installerPath, pid, installRoot, exeName }) {
  const baseName = exeName.replace(/\.exe$/i, '');
  const script = [
    'Wait-Process -Id ' + Number(pid) + ' -ErrorAction SilentlyContinue',
    '$root = ' + psQuote(installRoot),
    '$i = 0',
    'while ($i -lt 60) {',
    '  $left = Get-Process -Name ' + psQuote(baseName) + ' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) }',
    '  if (-not $left) { break }',
    '  Start-Sleep -Milliseconds 500',
    '  $i++',
    '}',
    'Start-Process -FilePath ' + psQuote(installerPath),
  ].join('; ');
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', script],
  };
}

/**
 * Earlier Sokuji installers left in the temp directory: every update left its
 * Setup.exe behind (a dozen of 150–280 MB each on one machine). Everything
 * named like one except the file just downloaded.
 * @param {string[]} names - directory entries
 * @param {string} keep - the current download's file name
 */
function staleInstallers(names, keep) {
  return names.filter((n) => /^Sokuji-.*\.Setup\.exe$/i.test(n) && n !== keep);
}

module.exports = { verifyDownloadedInstaller, installerLaunchCommand, staleInstallers };
