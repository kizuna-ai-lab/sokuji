// Replacing an installed virtual-audio driver that is older than the one the app ships.
//
// The pkg's postinstall is the only thing that ever copies the driver into
// /Library/Audio/Plug-Ins/HAL, and in-app updates replace Sokuji.app alone: a
// user who updates in the app keeps the driver they first installed for good.
// That is harmless while the driver never changes, and it did not change for a
// year. When it does, the app compares the version of the driver it ships with
// the installed one and offers to copy its own over, behind macOS's own
// administrator prompt, the same way the postinstall does it.
//
// The versions are compared for equality, not order: whichever driver the app
// ships is the one it was tested with.
const path = require('path');
const fsDefault = require('fs');
const audioHost = require('./audio-host.js');

const HAL_DIR = '/Library/Audio/Plug-Ins/HAL';
const DRIVER_BUNDLE = 'SokujiVirtualAudio.driver';
const INSTALLED_DRIVER_PATH = path.join(HAL_DIR, DRIVER_BUNDLE);
// Where electron-forge's `extraResource: ['assets', 'resources']` puts the copy
// the app ships; the pkg's postinstall reads it from the same place.
const BUNDLED_DRIVER_REL_PATH = path.join('resources', 'drivers', DRIVER_BUNDLE);
// The device the driver publishes, as macos-audio-utils.js matches it.
const VIRTUAL_DEVICE_NAME = 'SokujiVirtualAudio';

/**
 * The driver the app ships: under the packaged app's resources, or in the repo
 * during development. Null when neither exists.
 */
function resolveBundledDriverPath({
  resourcesPath = process.resourcesPath,
  appPath = path.join(__dirname, '..'),
  existsSync = fsDefault.existsSync,
} = {}) {
  const candidates = [
    resourcesPath ? path.join(resourcesPath, BUNDLED_DRIVER_REL_PATH) : null,
    path.join(appPath, BUNDLED_DRIVER_REL_PATH),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // A malformed path is a driver we cannot find, not a crash.
    }
  }
  return null;
}

/**
 * A driver bundle's CFBundleShortVersionString, or null when the bundle or the
 * key is missing. Xcode writes the bundle's Info.plist as XML.
 */
async function readDriverVersion(driverPath, { readFile = fsDefault.promises.readFile } = {}) {
  if (!driverPath) return null;
  let plist;
  try {
    plist = await readFile(path.join(driverPath, 'Contents', 'Info.plist'), 'utf8');
  } catch {
    return null;
  }
  const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/.exec(plist);
  return match ? match[1].trim() || null : null;
}

/**
 * Whether the installed driver differs from the one the app ships.
 *
 * @returns {Promise<{installed: string, bundled: string} | null>} both versions
 *   when they differ; null when they match, or when either driver or version is
 *   missing (no driver installed is the pkg's job, not an update).
 */
async function checkDriverUpdate({
  installedPath = INSTALLED_DRIVER_PATH,
  bundledPath = resolveBundledDriverPath(),
  readFile,
} = {}) {
  const [installed, bundled] = await Promise.all([
    readDriverVersion(installedPath, { readFile }),
    readDriverVersion(bundledPath, { readFile }),
  ]);
  if (!installed || !bundled || installed === bundled) return null;
  return { installed, bundled };
}

/** `s` as a single-quoted sh word. */
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** `s` as an AppleScript string literal. */
function appleScriptString(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The shell script that swaps the driver in, run as root. It does what the
 * pkg's postinstall does, for the same reasons: the copy is staged under a name
 * Core Audio does not load and moved in only once complete, and the installed
 * driver is set aside rather than deleted until the new one is in place, so a
 * copy that fails halfway never leaves the Mac without a virtual microphone.
 */
function driverSwapScript(sourcePath) {
  const src = shellQuote(sourcePath);
  const dest = shellQuote(INSTALLED_DRIVER_PATH);
  const stage = shellQuote(`${INSTALLED_DRIVER_PATH}.installing`);
  const prev = shellQuote(`${INSTALLED_DRIVER_PATH}.previous`);
  return [
    `rm -rf ${stage}`,
    `if ! cp -R ${src} ${stage} || ! chown -R root:wheel ${stage} || ! chmod -R 755 ${stage}; then rm -rf ${stage}; echo 'sokuji: staging the driver failed' >&2; exit 1; fi`,
    `rm -rf ${prev}`,
    `if [ -d ${dest} ] && ! mv ${dest} ${prev}; then rm -rf ${stage}; echo 'sokuji: moving the installed driver aside failed' >&2; exit 1; fi`,
    `if ! mv ${stage} ${dest}; then [ -d ${prev} ] && mv ${prev} ${dest}; rm -rf ${stage}; echo 'sokuji: moving the new driver into place failed' >&2; exit 1; fi`,
    `rm -rf ${prev}`,
    // The new driver is in place by now; a Core Audio that is not running (and
    // so has nothing to kill) still loads it when it next starts.
    '/usr/bin/killall coreaudiod || true',
  ].join('; ');
}

/**
 * Copy the app's driver over the installed one behind macOS's administrator
 * prompt, restart Core Audio, and wait for the device to register.
 *
 * @param {{prompt: string, bundledPath?: string|null, execFile?: Function, host?: object,
 *          sleep?: Function, now?: Function, deadlineMs?: number}} options
 * @returns {Promise<{ok: true} | {ok: false, cancelled: boolean, error?: string}>}
 */
async function installBundledDriver({
  prompt,
  bundledPath = resolveBundledDriverPath(),
  execFile = require('util').promisify(require('child_process').execFile),
  host = audioHost,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  deadlineMs = 15000,
} = {}) {
  if (!bundledPath) {
    return { ok: false, cancelled: false, error: 'The app does not contain a driver to install' };
  }
  const script = `do shell script ${appleScriptString(driverSwapScript(bundledPath))} with administrator privileges with prompt ${appleScriptString(prompt)}`;
  try {
    await execFile('/usr/bin/osascript', ['-e', script]);
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error);
    if (/\(-128\)|User canceled/.test(detail)) {
      console.log('[Sokuji] [macOS Audio] Driver update cancelled at the password dialog');
      return { ok: false, cancelled: true };
    }
    console.warn('[Sokuji] [macOS Audio] Driver update failed:', detail);
    return { ok: false, cancelled: false, error: detail.trim() };
  }

  // Core Audio restarts on its own and registers the device once it has loaded
  // the new driver. killall only signals it, so the old process can still be
  // answering - with the old driver's device - for a moment: wait before the
  // first probe. Bounded by time, as the repair is: a Core Audio that hangs
  // makes every probe wait out the helper's timeout.
  await sleep(1500);
  const deadline = now() + deadlineMs;
  do {
    let result = null;
    try {
      result = await host.ensureUnityGain(VIRTUAL_DEVICE_NAME);
    } catch {
      result = null;
    }
    if (result?.found) {
      console.log('[Sokuji] [macOS Audio] Driver updated and registered');
      return { ok: true };
    }
    await sleep(500);
  } while (now() < deadline);
  return { ok: false, cancelled: false, error: 'The virtual device did not register after the driver update' };
}

module.exports = {
  resolveBundledDriverPath,
  readDriverVersion,
  checkDriverUpdate,
  driverSwapScript,
  installBundledDriver,
  INSTALLED_DRIVER_PATH,
  BUNDLED_DRIVER_REL_PATH,
};
