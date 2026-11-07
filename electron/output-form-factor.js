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
  parsePactlCardsJson,
  parsePactlCardsText,
  parsePactlDefaultSink,
} = require('./output-form-factor-parse.js');

const READ_TIMEOUT_MS = 3000;
const MAX_STDOUT_BYTES = 1024 * 1024;
const DEBOUNCE_MS = 200;
const DEFAULT_BACKOFF_MS = [1000, 5000, 30000, 60000];
// How long the Linux read waits for `pactl list cards` once the sinks are in.
// The cards only add a bus; a stuck one must not cost the devices.
const CARDS_GRACE_MS = 500;
// A sink appearing, changing (a laptop's port switch keeps the sink) or going -
// Chromium on Linux misses some Bluetooth and PipeWire ones - and the server
// changing (a new default sink).
const SINK_EVENT = /^Event '(?:new|change|remove)' on sink #\d+|^Event 'change' on server/;

// Parsers read English keys; a translated pactl would print different ones.
const pactlEnv = () => ({ ...process.env, LC_ALL: 'C' });

// A console program started from a GUI parent gets a window of its own unless
// windowsHide is set (only then does libuv pass CREATE_NO_WINDOW), and these
// run on every devicechange. stdin and stderr are never read: a long-lived
// `pactl subscribe` must not block on a full stderr pipe.
const childOptions = (options) => ({ ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * Run one child to completion, collecting stdout up to a cap.
 * Resolves (never rejects) with { status: 'ok', code, out } or
 * { status: 'spawn_failed' | 'overflow' | 'aborted' }. Children are registered
 * in `ctx.live` so the read's single deadline can kill whatever is still
 * running; once the deadline sets `ctx.over`, nothing new is spawned.
 */
function runChild(spawn, ctx, command, args, options, onSpawn) {
  const { live } = ctx;
  return new Promise((resolve) => {
    if (ctx.over) return resolve({ status: 'aborted' });
    let settled = false;
    const chunks = [];
    let size = 0;
    let child;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (child) live.delete(child);
      resolve(result);
    };
    try {
      child = spawn(command, args, childOptions(options));
    } catch {
      return settle({ status: 'spawn_failed' });
    }
    live.add(child);
    if (onSpawn) onSpawn(child);
    child.stdout.on('data', (d) => {
      size += d.length;
      if (size > MAX_STDOUT_BYTES) {
        child.kill('SIGKILL');
        return settle({ status: 'overflow' });
      }
      chunks.push(Buffer.from(d));
    });
    child.on('error', () => settle({ status: 'spawn_failed' }));
    child.on('close', (code) => settle({ status: 'ok', code, out: Buffer.concat(chunks).toString('utf8') }));
  });
}

// Maps a finished run to a failure reason, or null when it exited 0.
function failureOf(run) {
  if (run.status === 'aborted') return 'timeout';
  if (run.status === 'spawn_failed') return 'spawn_failed';
  if (run.status === 'overflow') return 'unparsable';
  return run.code === 0 ? null : `exit_${run.code}`;
}

async function readHelper(spawn, ctx, exe, parse) {
  const run = await runChild(spawn, ctx, exe, ['--devices']);
  const failure = failureOf(run);
  if (failure) return { ok: false, reason: failure };
  const devices = parse(run.out);
  return devices ? { ok: true, devices } : { ok: false, reason: 'unparsable' };
}

// One attempt of the Linux read in either form. `json` selects `-f json`.
async function readPactl(spawn, ctx, json) {
  const pre = json ? ['-f', 'json'] : [];
  const options = { env: pactlEnv() };
  const infoRun = runChild(spawn, ctx, 'pactl', [...pre, 'info'], options);
  const sinksRun = runChild(spawn, ctx, 'pactl', [...pre, 'list', 'sinks'], options);
  let cardsChild = null;
  const cardsRun = runChild(spawn, ctx, 'pactl', [...pre, 'list', 'cards'], options, (c) => (cardsChild = c));
  // The cards only fill in a bus the sinks leave out (PipeWire 0.3): they are
  // waited for a short while after the sinks, and a failed, stuck or
  // unparsable cards read costs that bus, never the devices.
  const stopCards = () => {
    if (cardsChild) cardsChild.kill('SIGKILL');
  };
  const [info, sinks] = await Promise.all([infoRun, sinksRun]);
  const failure = failureOf(sinks) || (json ? failureOf(info) || infoUnparsable(info.out) : null);
  if (failure) {
    stopCards();
    return { ok: false, reason: failure };
  }
  // A failed `info` in text form only costs the default: no device is default.
  const defaultName = info.status === 'ok' && info.code === 0 ? parsePactlDefaultSink(info.out, json) : null;
  const cards = await settleWithin(cardsRun, CARDS_GRACE_MS);
  if (!cards) stopCards();
  const cardList = !cards || failureOf(cards) ? null : (json ? parsePactlCardsJson : parsePactlCardsText)(cards.out);
  const devices = (json ? parsePactlSinksJson : parsePactlSinksText)(sinks.out, defaultName, cardList);
  return devices ? { ok: true, devices } : { ok: false, reason: 'unparsable' };
}

// The promise's value, or null when it has not settled within `ms`.
function settleWithin(promise, ms) {
  let timer;
  const expired = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

// `pactl -f json info` must be a JSON object; anything else sends the read to
// the text form instead of silently losing the default.
function infoUnparsable(text) {
  try {
    const info = JSON.parse(text);
    return info && typeof info === 'object' && !Array.isArray(info) ? null : 'unparsable';
  } catch {
    return 'unparsable';
  }
}

async function readLinux(spawn, ctx) {
  const first = await readPactl(spawn, ctx, true);
  // After the deadline the killed children report a null exit; that is the
  // timeout, not a reason to start the text attempt.
  if (first.ok || ctx.over) return first;
  return readPactl(spawn, ctx, false);
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
    start = (ctx) => {
      const exe = resolvePath();
      return exe ? readHelper(spawn, ctx, exe, parse) : { ok: false, reason: 'no_helper' };
    };
  } else if (platform === 'linux') {
    start = (ctx) => readLinux(spawn, ctx);
  } else {
    return { ok: false, reason: 'unsupported_platform' };
  }

  const ctx = { live: new Set(), over: false };
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      // A hung helper must not outlive the read; a killed child's late close
      // lands on an already-settled promise and is ignored.
      ctx.over = true;
      for (const child of ctx.live) child.kill('SIGKILL');
      resolve({ ok: false, reason: 'timeout' });
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => start(ctx)).catch(() => ({ ok: false, reason: 'spawn_failed' })),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Watches `pactl subscribe` for sinks appearing, changing or going (a new
 * default sink arrives as a `server` change) and calls onChange once per burst,
 * and once after a relaunch that stays up, for what changed while it was down.
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
  /** The pending push is only a relaunch's catch-up, no change the child reported. */
  let catchUpOnly = false;
  let failures = 0;
  let warned = false;

  const schedulePush = (catchUp) => {
    // A reported change already pending stays one when a catch-up joins it.
    catchUpOnly = catchUp && (debounceTimer === null || catchUpOnly);
    if (debounceTimer) clearTimer(debounceTimer);
    debounceTimer = setTimer(() => {
      debounceTimer = null;
      catchUpOnly = false;
      if (started) onChange();
    }, DEBOUNCE_MS);
  };

  const launch = (relaunch) => {
    restartTimer = null;
    let current;
    try {
      current = spawn('pactl', ['subscribe'], childOptions({ env: pactlEnv() }));
    } catch {
      return onExit(null);
    }
    child = current;
    // Sinks may have changed while no watcher ran: read once more when it is back.
    // Not on a spawn that fails (no 'spawn' event), and onExit takes it back from
    // one that dies inside the window (the server down), so a watcher stuck
    // restarting does not become a read on every backoff.
    if (relaunch) {
      current.once('spawn', () => {
        if (child === current) schedulePush(true);
      });
    }
    let pending = '';
    current.stdout.on('data', (d) => {
      pending += d.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop();
      if (lines.some((l) => SINK_EVENT.test(l))) schedulePush(false);
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
    if (catchUpOnly && debounceTimer) {
      clearTimer(debounceTimer);
      debounceTimer = null;
      catchUpOnly = false;
    }
    if (!warned) {
      warned = true;
      warn('pactl subscribe stopped; restarting. Output device changes may be missed until it is back.');
    }
    const delay = backoffMs[Math.min(failures, backoffMs.length - 1)];
    failures++;
    restartTimer = setTimer(() => launch(true), delay);
  };

  return {
    start() {
      if (started) return;
      started = true;
      failures = 0;
      warned = false;
      launch(false);
    },
    stop() {
      started = false;
      if (restartTimer) clearTimer(restartTimer);
      if (debounceTimer) clearTimer(debounceTimer);
      restartTimer = null;
      debounceTimer = null;
      catchUpOnly = false;
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
