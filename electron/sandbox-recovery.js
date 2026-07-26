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

// ---------------------------------------------------------------------------
// Orchestration (electron `app`/`dialog` passed in; all win32-gated).
// State markers live in userData (%APPDATA%\sokuji, the Roaming tree), which is
// unaffected by the corrupted Local-tree DACL.
// ---------------------------------------------------------------------------

const path = require('path');

const CRASH_MARKER = 'sandbox-crash-marker.json';
const FALLBACK_MARKER = 'no-sandbox-fallback.json';

/** Real dependencies, overridable in tests via options.deps. */
function defaultDeps() {
  return {
    platform: process.platform,
    fs: require('fs'),
    execFileSync: require('child_process').execFileSync,
    now: () => Date.now(),
    env: process.env,
    log: (...a) => console.log('[Sokuji] [SandboxRecovery]', ...a),
    // Runs before every app.exit()/relaunch this module triggers. app.exit()
    // skips before-quit/will-quit, so main.js's cleanupAndExit (which stops the
    // native sidecar and releases its Windows file locks) would otherwise never
    // run, orphaning the sidecar process. main.js injects the real teardown.
    beforeExit: () => {},
  };
}

function mergeDeps(deps) {
  return { ...defaultDeps(), ...(deps || {}) };
}

function readJsonFile(fs, filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function safeUnlink(fs, filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* already gone */
  }
}

/**
 * Directories whose DACL can carry the inherited orphan ACE: the install dir,
 * %LOCALAPPDATA% and %USERPROFILE%. Deduped; missing env vars skipped.
 * @param {{getPath: Function}} app
 * @param {Record<string,string>} env
 * @returns {string[]}
 */
function getScanDirectories(app, env) {
  const dirs = [];
  try {
    dirs.push(path.dirname(app.getPath('exe')));
  } catch {
    /* ignore */
  }
  if (env.LOCALAPPDATA) dirs.push(env.LOCALAPPDATA);
  if (env.USERPROFILE) dirs.push(env.USERPROFILE);
  return [...new Set(dirs)];
}

/**
 * Wiring point #1 — at the very top of main.js, before app is ready.
 * Reads the persistent no-sandbox fallback marker and, if it applies to the
 * current version, appends the --no-sandbox switch. A version change clears the
 * marker so the sandbox is retried (the ACL may have been fixed meanwhile).
 * @returns {boolean} whether --no-sandbox was applied.
 */
function applyNoSandboxFlag(app, options = {}) {
  const deps = mergeDeps(options.deps);
  if (deps.platform !== 'win32') return false;
  const userData = options.userDataDir || app.getPath('userData');
  const filePath = path.join(userData, FALLBACK_MARKER);
  const marker = readJsonFile(deps.fs, filePath);
  const { noSandbox, clearMarker } = evaluateNoSandbox(marker, app.getVersion());
  if (clearMarker) {
    safeUnlink(deps.fs, filePath);
    deps.log('fallback marker version changed; cleared, retrying with sandbox');
  }
  if (noSandbox) {
    app.commandLine.appendSwitch('no-sandbox');
    deps.log('applying --no-sandbox from persistent fallback marker');
  }
  return noSandbox;
}

/**
 * Wiring point #3 — register the passive GPU-crash detector. On a matching
 * crash it synchronously writes the crash marker (so recovery survives even if
 * Chromium's FATAL kills us first) and relaunches into recovery mode, up to the
 * hourly auto-relaunch cap.
 */
function registerCrashDetection(app, options = {}) {
  const deps = mergeDeps(options.deps);
  if (deps.platform !== 'win32') return;
  const userData = options.userDataDir || app.getPath('userData');
  const crashPath = path.join(userData, CRASH_MARKER);

  app.on('child-process-gone', (event, details) => {
    if (!isGpuSandboxCrash(details)) return;
    deps.log('GPU sandbox crash detected:', JSON.stringify(details));
    const existing = readJsonFile(deps.fs, crashPath);
    const { marker, shouldRelaunch } = evaluateCrashRelaunch(
      existing,
      deps.now(),
      app.getVersion()
    );
    try {
      deps.fs.writeFileSync(crashPath, JSON.stringify(marker));
    } catch (e) {
      deps.log('failed to write crash marker:', e && e.message);
    }
    if (shouldRelaunch) {
      deps.log('relaunching into recovery mode');
      deps.beforeExit();
      app.relaunch();
      app.exit(0);
    } else {
      deps.log('auto-relaunch cap reached; marker left for next manual launch');
    }
  });
}

function stampFromNow(now) {
  // ISO-8601 with filename-safe separators, e.g. 2026-07-24T04-00-00-000Z.
  return new Date(now).toISOString().replace(/[:.]/g, '-');
}

/**
 * Back up, then remove the explicit orphan ACEs, then re-scan to verify.
 * @returns {{success: boolean, remaining: object[], backupPath: string}}
 */
function performRepair(confirmed, userData, deps) {
  const backupPath = path.join(userData, `sandbox-recovery-backup-${stampFromNow(deps.now())}.log`);
  let backupWritten = false;
  try {
    deps.fs.writeFileSync(backupPath, buildBackupLog(confirmed, stampFromNow(deps.now())));
    backupWritten = true;
    deps.log('wrote ACL backup to', backupPath);
  } catch (e) {
    deps.log('failed to write backup log:', e && e.message);
  }

  let hadErrors = false;
  for (const r of confirmed) {
    const result = repairDirectory(r.dir, r.sids, deps);
    if (result.errors.length > 0) {
      hadErrors = true;
      deps.log('icacls /remove errors at', r.dir, JSON.stringify(result.errors));
    }
  }

  const rescan = confirmed.map((r) => scanDirectory(r.dir, deps));
  const remaining = rescan.filter((r) => r.sids.length > 0 || r.error);
  return { success: remaining.length === 0 && !hadErrors, remaining, backupPath, backupWritten };
}

function writeFallbackAndRelaunch(app, deps, userData, crashPath) {
  const fallbackPath = path.join(userData, FALLBACK_MARKER);
  try {
    deps.fs.writeFileSync(fallbackPath, JSON.stringify({ appVersion: app.getVersion() }));
    deps.log('wrote no-sandbox fallback marker for', app.getVersion());
  } catch (e) {
    deps.log('failed to write fallback marker:', e && e.message);
  }
  safeUnlink(deps.fs, crashPath);
  deps.beforeExit();
  app.relaunch();
  app.exit(0);
}

function quit(app, deps, crashPath) {
  safeUnlink(deps.fs, crashPath);
  deps.beforeExit();
  app.exit(0);
}

function showConfirmedDialog(dialog, confirmed) {
  const dirs = confirmed.map((r) => r.dir).join('\n');
  return dialog.showMessageBoxSync({
    type: 'warning',
    title: 'Sokuji — Sandbox Startup Problem',
    message:
      "Another program corrupted Windows permissions, preventing Sokuji's security sandbox from starting.",
    detail:
      'This is a known problem caused by leftover sandbox permissions from tools such as ' +
      'OpenAI Codex CLI or Google Antigravity. Sokuji can repair it without administrator ' +
      'rights — only the orphaned permission entries are removed; nothing else is touched.\n\n' +
      `Affected locations:\n${dirs}\n\n` +
      `More details: ${ISSUE_URL}`,
    buttons: ['Repair permissions (recommended)', 'Continue without sandbox', 'Quit'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
}

function showUnconfirmedDialog(dialog) {
  return dialog.showMessageBoxSync({
    type: 'warning',
    title: 'Sokuji — Sandbox Startup Problem',
    message: "Sokuji's security sandbox process repeatedly failed to start.",
    detail:
      'The cause could not be confirmed automatically. It is often corrupted Windows ' +
      'permissions or antivirus injection. You can continue with the sandbox disabled ' +
      '(reduced isolation) or quit and investigate.\n\n' +
      `More details: ${ISSUE_URL}`,
    buttons: ['Continue without sandbox', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
}

function showRepairFailedDialog(dialog, repairResult) {
  const remaining = repairResult.remaining.map((r) => r.dir).join('\n');
  const backupLine = repairResult.backupWritten
    ? `A backup of the original permissions was saved to:\n${repairResult.backupPath}\n\n`
    : '';
  return dialog.showMessageBoxSync({
    type: 'error',
    title: 'Sokuji — Repair Incomplete',
    message: 'The permission repair did not fully succeed.',
    detail:
      'Some orphaned entries could not be removed (they may require different ownership).\n' +
      (remaining ? `Still affected:\n${remaining}\n\n` : '\n') +
      backupLine +
      `More details: ${ISSUE_URL}`,
    buttons: ['Continue without sandbox', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
}

/**
 * Wiring point #2 — run inside whenReady BEFORE createWindow. The main window is
 * transparent, so a dead renderer shows as an empty pane; the dialog must be
 * shown from the (unsandboxed) browser process before any window exists.
 *
 * @returns {boolean} true => proceed to createWindow; false => we have already
 *   relaunched or exited and the caller must NOT create a window.
 */
function handleRecoveryMode(app, dialog, options = {}) {
  const deps = mergeDeps(options.deps);
  if (deps.platform !== 'win32') return true;
  const userData = options.userDataDir || app.getPath('userData');
  const crashPath = path.join(userData, CRASH_MARKER);

  const crashMarker = readJsonFile(deps.fs, crashPath);
  if (!crashMarker) return true; // normal startup

  deps.log('crash marker present; entering recovery mode');
  const scanResults = getScanDirectories(app, deps.env).map((d) => scanDirectory(d, deps));
  const confirmed = scanResults.filter((r) => r.sids.length > 0);

  if (confirmed.length > 0) {
    const choice = showConfirmedDialog(dialog, confirmed);
    if (choice === 0) {
      const repairResult = performRepair(confirmed, userData, deps);
      if (repairResult.success) {
        deps.log('repair verified clean; relaunching with sandbox');
        safeUnlink(deps.fs, crashPath);
        deps.beforeExit();
        app.relaunch();
        app.exit(0);
        return false;
      }
      const followUp = showRepairFailedDialog(dialog, repairResult);
      if (followUp === 0) {
        writeFallbackAndRelaunch(app, deps, userData, crashPath);
      } else {
        quit(app, deps, crashPath);
      }
      return false;
    }
    if (choice === 1) {
      writeFallbackAndRelaunch(app, deps, userData, crashPath);
    } else {
      quit(app, deps, crashPath);
    }
    return false;
  }

  // Unconfirmed: crash signature fired but the ACL scan is clean. Never offer
  // to modify ACLs without a confirmed diagnosis.
  const choice = showUnconfirmedDialog(dialog);
  if (choice === 0) {
    writeFallbackAndRelaunch(app, deps, userData, crashPath);
  } else {
    quit(app, deps, crashPath);
  }
  return false;
}

module.exports = {
  ORPHAN_SID_RE,
  ISSUE_URL,
  UPSTREAM_URL,
  CRASH_MARKER,
  FALLBACK_MARKER,
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
};
