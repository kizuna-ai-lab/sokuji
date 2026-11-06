// Main-process reader for the output devices' form factor (issue #691).
//
// The renderer only sees what the browser reports (a label); the system knows
// whether an output is a speaker or headphones. This module asks the system -
// the macOS/Windows helper's `--devices`, or `pactl` on Linux - and pushes a
// notice when the answer may have changed. It never rejects and never blocks:
// a failed read is a reason string the renderer maps to `unknown`.
//
// It does not require('electron'): main.js hands in ipcMain / powerMonitor /
// app, so the reader can be run with plain node and tested with fakes.
const { spawn: nodeSpawn } = require('child_process');
const { resolveAudioHostPath } = require('./audio-host-path.js');
const {
  parseMacDevices,
  parseWinDevices,
  parsePactlSinksJson,
  parsePactlSinksText,
  parsePactlDefaultSink,
} = require('./output-form-factor-parse.js');

const READ_TIMEOUT_MS = 3000;
const MAX_STDOUT_BYTES = 1024 * 1024;
const DEBOUNCE_MS = 200;
const DEFAULT_BACKOFF_MS = [1000, 5000, 30000, 60000];
const CHANGE_LINE = /^Event 'change' on (sink #\d+|server)/;

// Parsers read English keys; a translated pactl would print different ones.
const pactlEnv = () => ({ ...process.env, LC_ALL: 'C' });

/**
 * Run one child to completion, collecting stdout up to a cap.
 * Resolves (never rejects) with { status: 'ok', code, out } or
 * { status: 'spawn_failed' | 'overflow' }. Children are registered in `live`
 * so the caller's single deadline can kill whatever is still running.
 */
function runChild(spawn, live, command, args, options) {
  return new Promise((resolve) => {
    let settled = false;
    let out = '';
    let size = 0;
    let child;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (child) live.delete(child);
      resolve(result);
    };
    try {
      child = spawn(command, args, options);
    } catch {
      return settle({ status: 'spawn_failed' });
    }
    live.add(child);
    child.stdout.on('data', (d) => {
      size += d.length;
      if (size > MAX_STDOUT_BYTES) {
        child.kill('SIGKILL');
        return settle({ status: 'overflow' });
      }
      out += d.toString('utf8');
    });
    child.on('error', () => settle({ status: 'spawn_failed' }));
    child.on('close', (code) => settle({ status: 'ok', code, out }));
  });
}

// Maps a finished run to a failure reason, or null when it exited 0.
function failureOf(run) {
  if (run.status === 'spawn_failed') return 'spawn_failed';
  if (run.status === 'overflow') return 'unparsable';
  return run.code === 0 ? null : `exit_${run.code}`;
}

async function readHelper(spawn, live, exe, parse) {
  const run = await runChild(spawn, live, exe, ['--devices']);
  const failure = failureOf(run);
  if (failure) return { ok: false, reason: failure };
  const devices = parse(run.out);
  return devices ? { ok: true, devices } : { ok: false, reason: 'unparsable' };
}

// One attempt of the Linux read in either form. `json` selects `-f json`.
async function readPactl(spawn, live, json) {
  const pre = json ? ['-f', 'json'] : [];
  const options = { env: pactlEnv() };
  const [info, sinks] = await Promise.all([
    runChild(spawn, live, 'pactl', [...pre, 'info'], options),
    runChild(spawn, live, 'pactl', [...pre, 'list', 'sinks'], options),
  ]);
  const failure = failureOf(sinks) || (json ? failureOf(info) : null);
  if (failure) return { ok: false, reason: failure };
  // A failed `info` in text form only costs the default: no device is default.
  const defaultName = info.status === 'ok' && info.code === 0 ? parsePactlDefaultSink(info.out, json) : null;
  const devices = (json ? parsePactlSinksJson : parsePactlSinksText)(sinks.out, defaultName);
  return devices ? { ok: true, devices } : { ok: false, reason: 'unparsable' };
}

async function readLinux(spawn, live) {
  const first = await readPactl(spawn, live, true);
  if (first.ok) return first;
  return readPactl(spawn, live, false);
}

/**
 * Read the system's output devices once, within a hard 3 s bound.
 * @returns {Promise<{ok: true, devices: object[]} | {ok: false, reason: string}>}
 */
async function getOutputDevices({
  platform = process.platform,
  spawn = nodeSpawn,
  resolvePath = resolveAudioHostPath,
  timeoutMs = READ_TIMEOUT_MS,
} = {}) {
  let start;
  if (platform === 'darwin' || platform === 'win32') {
    const parse = platform === 'darwin' ? parseMacDevices : parseWinDevices;
    start = (live) => {
      const exe = resolvePath();
      return exe ? readHelper(spawn, live, exe, parse) : { ok: false, reason: 'no_helper' };
    };
  } else if (platform === 'linux') {
    start = (live) => readLinux(spawn, live);
  } else {
    return { ok: false, reason: 'unsupported_platform' };
  }

  const live = new Set();
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      // A hung helper must not outlive the read; a killed child's late close
      // lands on an already-settled promise and is ignored.
      for (const child of live) child.kill('SIGKILL');
      resolve({ ok: false, reason: 'timeout' });
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => start(live)).catch(() => ({ ok: false, reason: 'spawn_failed' })),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Watches `pactl subscribe` for sink changes (a new default sink arrives as a
 * `server` change) and calls onChange once per burst.
 */
function createSinkWatcher({
  spawn,
  onChange,
  warn,
  backoffMs = DEFAULT_BACKOFF_MS,
  setTimeout: setTimer = setTimeout,
  clearTimeout: clearTimer = clearTimeout,
}) {
  let started = false;
  let child = null;
  let restartTimer = null;
  let debounceTimer = null;
  let failures = 0;
  let warned = false;

  const launch = () => {
    restartTimer = null;
    let current;
    try {
      current = spawn('pactl', ['subscribe'], { env: pactlEnv() });
    } catch {
      return onExit(null);
    }
    child = current;
    let pending = '';
    current.stdout.on('data', (d) => {
      pending += d.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop();
      if (!lines.some((l) => CHANGE_LINE.test(l))) return;
      if (debounceTimer) clearTimer(debounceTimer);
      debounceTimer = setTimer(() => {
        debounceTimer = null;
        if (started) onChange();
      }, DEBOUNCE_MS);
    });
    // 'error' and 'close' can both fire for one child; only the first counts.
    const gone = () => onExit(current);
    current.on('error', gone);
    current.on('close', gone);
  };

  const onExit = (exited) => {
    if (!started) return;
    if (exited) {
      if (child !== exited) return;
      child = null;
    }
    if (!warned) {
      warned = true;
      warn('pactl subscribe stopped; restarting. Output device changes may be missed until it is back.');
    }
    const delay = backoffMs[Math.min(failures, backoffMs.length - 1)];
    failures++;
    restartTimer = setTimer(launch, delay);
  };

  return {
    start() {
      if (started) return;
      started = true;
      failures = 0;
      warned = false;
      launch();
    },
    stop() {
      started = false;
      if (restartTimer) clearTimer(restartTimer);
      if (debounceTimer) clearTimer(debounceTimer);
      restartTimer = null;
      debounceTimer = null;
      if (child) {
        const old = child;
        child = null;
        old.kill();
      }
    },
  };
}

function registerOutputFormFactor({
  ipcMain,
  powerMonitor,
  app,
  getWindows,
  platform = process.platform,
  spawn = nodeSpawn,
  resolvePath = resolveAudioHostPath,
}) {
  const push = () => {
    for (const win of getWindows()) {
      if (win.isDestroyed && win.isDestroyed()) continue;
      win.webContents.send('output-devices:changed');
    }
  };
  const watcher = createSinkWatcher({
    spawn,
    onChange: push,
    warn: (msg) => console.warn(`[Sokuji] [OutputFormFactor] ${msg}`),
  });

  ipcMain.handle('get-output-devices', () => {
    if (platform === 'linux') watcher.start();
    return getOutputDevices({ platform, spawn, resolvePath });
  });
  powerMonitor.on('resume', push);
  app.on('window-all-closed', () => watcher.stop());
  app.on('before-quit', () => watcher.stop());
}

module.exports = { getOutputDevices, createSinkWatcher, registerOutputFormFactor, READ_TIMEOUT_MS };
