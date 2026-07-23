/**
 * Windows sandbox crash self-healing (issue #352).
 *
 * On some Windows machines, other software (e.g. OpenAI Codex CLI's elevated
 * sandbox, Google Antigravity's Gemini sandbox, or MSIX installers that leave
 * ACEs behind on uninstall) writes an orphaned AppContainer SID ACE onto
 * %LOCALAPPDATA% or %USERPROFILE%. That ACE is inherited by Sokuji's install
 * and data directories. Chromium's sandboxed child processes (GPU, renderer)
 * launch under a restricted token that the corrupted DACL then locks out of
 * the install directory, so the child dies at CHECK(InitializeICU()) while
 * memory-mapping icudtl.dat. After three GPU crashes Chromium fatally kills the
 * whole app, which the user sees as a silent startup crash.
 *
 * The orphan ACE can be removed without administrator rights (the user owns
 * their own profile directories, which implies WRITE_DAC). Removing just the
 * explicit orphan ACE heals the whole inheritance chain.
 *
 * Everything here is gated on win32 at the call sites in main.js. This module
 * intentionally does NOT require('electron') at load time so it stays unit
 * testable under plain Node/vitest; electron `app`/`dialog` are passed in.
 *
 * Upstream: https://github.com/electron/electron/issues/51761
 * Issue:    https://github.com/kizuna-ai-lab/sokuji/issues/352
 */

// Orphan AppContainer package SID: "S-1-15-2" followed by 6+ sub-authority
// groups. This deliberately excludes the legit well-known capability SIDs
// S-1-15-2-1 (ALL APPLICATION PACKAGES) and S-1-15-2-2 (ALL RESTRICTED
// APPLICATION PACKAGES), which have only a single sub-authority.
const ORPHAN_SID_RE = /S-1-15-2(?:-\d+){6,}/;

/**
 * Parse one directory's `icacls <dir>` output into orphan-SID ACE records.
 *
 * Processes line by line and extracts only ASCII SID + flag tokens, so the OEM
 * code page and any localized account names in the surrounding text are
 * irrelevant. An ACE is treated as inherited only when its trailing flag list
 * contains the standalone "(I)" group (distinct from "(OI)", "(CI)", "(IO)").
 *
 * @param {string} text - icacls output (already decoded to a JS string).
 * @returns {Array<{sid: string, inherited: boolean}>} one entry per line that
 *   carries an orphan AppContainer SID.
 */
function parseIcaclsAces(text) {
  const results = [];
  for (const line of String(text).split(/\r?\n/)) {
    const sidMatch = line.match(ORPHAN_SID_RE);
    if (!sidMatch) continue;

    // Grab the trailing run of consecutive "(...)" flag groups. The account
    // name may itself contain "(S-1-15-2-...)", but that is separated from the
    // flags by the ":" delimiter, so the trailing run never includes it.
    const flagsMatch = line.match(/((?:\([^)]*\))+)\s*$/);
    const flags = flagsMatch ? flagsMatch[1] : '';
    const groups = (flags.match(/\(([^)]*)\)/g) || []).map((g) => g.slice(1, -1));
    const inherited = groups.includes('I');

    results.push({ sid: sidMatch[0], inherited });
  }
  return results;
}

/**
 * Unique list of EXPLICIT (non-inherited) orphan SIDs defined at a directory.
 * These are the only ACEs the repair step ever removes.
 *
 * @param {string} text - icacls output.
 * @returns {string[]}
 */
function findExplicitOrphanSids(text) {
  const seen = new Set();
  for (const ace of parseIcaclsAces(text)) {
    if (!ace.inherited) seen.add(ace.sid);
  }
  return [...seen];
}

// STATUS_BREAKPOINT (0x80000003) is how a Chromium child process exits when a
// startup CHECK fails — including CHECK(InitializeICU()), the first file op the
// restricted-token child performs. Electron surfaces it as a signed int32
// (-2147483645); some builds/paths report it unsigned (2147483651). This is a
// generic "child died at a startup CHECK" signature, NOT proof of the ACL bug,
// so it only triggers a diagnostic ACL scan — never a blind repair.
const STATUS_BREAKPOINT_SIGNED = -2147483645;
const STATUS_BREAKPOINT_UNSIGNED = 2147483651;

/**
 * Whether a `child-process-gone` event looks like the sandbox startup crash.
 * @param {{type?: string, reason?: string, exitCode?: number} | null} details
 * @returns {boolean}
 */
function isGpuSandboxCrash(details) {
  if (!details || details.type !== 'GPU') return false;
  if (details.reason !== 'crashed' && details.reason !== 'abnormal-exit') return false;
  return (
    details.exitCode === STATUS_BREAKPOINT_SIGNED ||
    details.exitCode === STATUS_BREAKPOINT_UNSIGNED
  );
}

const CRASH_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_AUTO_RELAUNCH = 2;

/**
 * Decide whether to auto-relaunch after a sandbox crash, and produce the next
 * crash-marker contents. Caps automatic relaunches to avoid a crash loop; once
 * the cap is hit the crash is still recorded so the next manual launch enters
 * recovery mode.
 *
 * @param {{timestamps?: number[]} | null} existingMarker
 * @param {number} now - current epoch ms.
 * @param {string} appVersion
 * @param {{windowMs?: number, maxAutoRelaunch?: number}} [opts]
 * @returns {{marker: {timestamps: number[], appVersion: string}, shouldRelaunch: boolean}}
 */
function evaluateCrashRelaunch(existingMarker, now, appVersion, opts = {}) {
  const windowMs = opts.windowMs ?? CRASH_WINDOW_MS;
  const maxAutoRelaunch = opts.maxAutoRelaunch ?? MAX_AUTO_RELAUNCH;
  const priorRaw = Array.isArray(existingMarker && existingMarker.timestamps)
    ? existingMarker.timestamps
    : [];
  const prior = priorRaw.filter((t) => typeof t === 'number' && now - t < windowMs);
  const marker = { timestamps: [...prior, now], appVersion };
  const shouldRelaunch = prior.length < maxAutoRelaunch;
  return { marker, shouldRelaunch };
}

/**
 * Decide how to treat the persistent no-sandbox fallback marker at startup.
 * Same version => keep running without the sandbox. Different version =>
 * discard the marker and try the sandbox again (the ACL may have been fixed).
 *
 * @param {{appVersion?: string} | null} marker
 * @param {string} currentVersion
 * @returns {{noSandbox: boolean, clearMarker: boolean}}
 */
function evaluateNoSandbox(marker, currentVersion) {
  if (!marker || typeof marker.appVersion !== 'string') {
    return { noSandbox: false, clearMarker: false };
  }
  if (marker.appVersion === currentVersion) {
    return { noSandbox: true, clearMarker: false };
  }
  return { noSandbox: false, clearMarker: true };
}

const ISSUE_URL = 'https://github.com/kizuna-ai-lab/sokuji/issues/352';
const UPSTREAM_URL = 'https://github.com/electron/electron/issues/51761';

/**
 * Run `icacls <dir>` and return the explicit orphan SIDs it defines.
 * icacls output is decoded as latin1 (byte-preserving) so an OEM code page and
 * localized account names never break the ASCII SID/flag extraction.
 *
 * @param {string} dir
 * @param {{execFileSync: Function}} deps
 * @returns {{dir: string, sids: string[], rawOutput: string, error: string|null}}
 */
function scanDirectory(dir, deps) {
  try {
    const out = deps.execFileSync('icacls', [dir], { windowsHide: true });
    const text = Buffer.isBuffer(out) ? out.toString('latin1') : String(out);
    return { dir, sids: findExplicitOrphanSids(text), rawOutput: text, error: null };
  } catch (err) {
    return { dir, sids: [], rawOutput: '', error: (err && err.message) || String(err) };
  }
}

/**
 * Remove each given orphan SID's explicit ACE from a directory via
 * `icacls <dir> /remove "*<SID>"`. The "*" prefix selects by raw SID; plain
 * /remove strips both grant and deny ACEs. Never uses /reset. Continues past a
 * failed SID and records it.
 *
 * @param {string} dir
 * @param {string[]} sids
 * @param {{execFileSync: Function}} deps
 * @returns {{dir: string, removed: string[], errors: Array<{sid: string, error: string}>}}
 */
function repairDirectory(dir, sids, deps) {
  const removed = [];
  const errors = [];
  for (const sid of sids) {
    try {
      deps.execFileSync('icacls', [dir, '/remove', `*${sid}`], { windowsHide: true });
      removed.push(sid);
    } catch (err) {
      errors.push({ sid, error: (err && err.message) || String(err) });
    }
  }
  return { dir, removed, errors };
}

/**
 * Build the human-readable text backup written before any ACL change, so a
 * removed ACE can be restored by hand with `icacls /grant` if ever needed.
 *
 * @param {Array<{dir: string, sids: string[], rawOutput: string}>} scanResults
 * @param {string} isoStamp
 * @returns {string}
 */
function buildBackupLog(scanResults, isoStamp) {
  let log = `Sokuji sandbox recovery backup — ${isoStamp}\n`;
  log += `Issue:    ${ISSUE_URL}\n`;
  log += `Upstream: ${UPSTREAM_URL}\n`;
  log += `\nThe explicit orphan AppContainer ACEs listed below were removed with\n`;
  log += `"icacls <dir> /remove *<SID>". To restore one manually, grant it back\n`;
  log += `with "icacls <dir> /grant *<SID>:(<perm>)".\n\n`;
  for (const r of scanResults) {
    log += `=== Directory: ${r.dir} ===\n`;
    log += `Removed explicit orphan SIDs:\n`;
    for (const sid of r.sids) log += `  - ${sid}\n`;
    log += `\nFull icacls output before removal:\n${r.rawOutput}\n\n`;
  }
  return log;
}

module.exports = {
  ORPHAN_SID_RE,
  ISSUE_URL,
  UPSTREAM_URL,
  parseIcaclsAces,
  findExplicitOrphanSids,
  isGpuSandboxCrash,
  evaluateCrashRelaunch,
  evaluateNoSandbox,
  scanDirectory,
  repairDirectory,
  buildBackupLog,
};
