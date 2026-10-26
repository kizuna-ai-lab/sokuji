// electron/update-install-windows.js
//
// The fallback Windows update — the full Squirrel Setup.exe — for a run
// without Update.exe. Its --install step deletes the whole install directory
// before writing the new version ("Install path … already exists, burning it
// to the ground"), and a file still held by the exiting app makes it crash
// with the directory half-deleted — the app is then simply gone
// (Squirrel-Install.log, 2026-10-27 02:34 JST, `Access to the path
// '…\app-0.46.1\sokuji.exe' is denied`). So the installer must not start
// until every process under the install root has exited — sokuji.exe and
// the audio helper alike — and must not start at all if they will not; and a
// damaged download must never be started.
//
// Pure helpers, no Electron: update-manager.js wires them in.
const { createHash } = require('crypto');
const { createReadStream, statSync } = require('fs');

/**
 * Check a downloaded installer against what latest.yml announced. Size first
 * (cheap, and the usual failure: a truncated download), then the base64
 * sha512. Fails closed: with nothing to check against, the file is not run.
 * @param {string} filePath
 * @param {{ size?: number, sha512?: string }} expected
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
async function verifyDownloadedInstaller(filePath, expected = {}) {
  const hasSize = typeof expected.size === 'number';
  const hasHash = typeof expected.sha512 === 'string' && expected.sha512.length > 0;
  if (!hasSize && !hasHash) return { ok: false, reason: 'latest.yml names no size or sha512 for this file' };
  if (hasSize) {
    const actual = statSync(filePath).size;
    if (actual !== expected.size) return { ok: false, reason: `size ${actual} != expected ${expected.size}` };
  }
  if (hasHash) {
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
 * The detached process that installs the update once this app is gone. It
 * waits for this process id (bounded), then until no process whose
 * executable lives under the install root remains (bounded), and starts the
 * installer only then. On either timeout it writes one line beside the
 * installer and exits WITHOUT running it: a blocked update leaves a working
 * app; an installer run over a live one does not.
 * @param {{ installerPath: string, pid: number, installRoot: string, systemRoot?: string }} o
 * @returns {{ file: string, args: string[] }}
 */
function installerLaunchCommand({ installerPath, pid, installRoot, systemRoot = 'C:\\Windows' }) {
  const id = Number(pid);
  const root = installRoot.endsWith('\\') ? installRoot : `${installRoot}\\`;
  // `-like` reads [ ] * ? as wildcards; a user name like "jiang[1]" would match
  // nothing and let the installer run over a live app. Backtick-escaped literal.
  const pattern = `${root.replace(/[[\]*?`]/g, (ch) => '`' + ch)}*`;
  const log = psQuote(`${installerPath}.launch.log`);
  const giveUp = (why) => `Add-Content -Path ${log} -Value ((Get-Date -Format o) + ' install skipped: ${why}'); exit 1`;
  const script = [
    `Wait-Process -Id ${id} -Timeout 120 -ErrorAction SilentlyContinue`,
    `if (Get-Process -Id ${id} -ErrorAction SilentlyContinue) { ${giveUp(`process ${id} still running after 120 s`)} }`,
    `$root = ${psQuote(root)}`,
    `$pattern = ${psQuote(pattern)}`,
    '$i = 0',
    '$left = $null',
    'while ($i -lt 60) {',
    '  $left = Get-Process | Where-Object { $_.Path -and ($_.Path -like $pattern) }',
    '  if (-not $left) { break }',
    '  Start-Sleep -Milliseconds 500',
    '  $i++',
    '}',
    `if ($left) { ${giveUp("processes still running under the install root: ' + (($left | ForEach-Object { $_.ProcessName }) -join ', ') + '")} }`,
    `Start-Process -FilePath ${psQuote(installerPath)}`,
  ].join('; ');
  return {
    file: `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
  };
}

/**
 * Earlier Sokuji installers left in the temp directory: every update left its
 * Setup.exe behind (a dozen of 150–280 MB each on one machine). Only files
 * named like one and older than `maxAgeMs`, so a download in progress or just
 * finished is never touched.
 * @param {Array<{ name: string, mtimeMs: number }>} entries
 * @param {{ now: number, maxAgeMs: number }} o
 */
function staleInstallers(entries, { now, maxAgeMs }) {
  return entries
    .filter((e) => isInstallerName(e.name) && now - e.mtimeMs > maxAgeMs)
    .map((e) => e.name);
}

/** Whether a file name is one of our Setup executables (CI names them `Sokuji-<version>.Setup.exe`). */
function isInstallerName(name) {
  return /^Sokuji-.*\.Setup\.exe$/i.test(name);
}

module.exports = { verifyDownloadedInstaller, installerLaunchCommand, staleInstallers, isInstallerName };
