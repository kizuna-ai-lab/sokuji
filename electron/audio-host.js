// Spawn and parse the per-application capture helper (issue #335).
//
// Platform-neutral: the Windows, macOS and any future helper all honour the same
// command line (--list / --target pid:N, PCM on stdout, JSON lines on stderr),
// so this layer needs no per-platform branching. Locating the binary is the only
// platform-specific part, and that lives in audio-host-path.js.
//
// The helper is a short-lived filter, not a daemon: `--list` runs and exits,
// `--target` streams PCM on stdout until killed. Nothing here keeps a socket or
// a handshake, so there is no surface for other local processes to attach to.
const { spawn: nodeSpawn } = require('child_process');
const { resolveAudioHostPath } = require('./audio-host-path.js');

// At most one capture runs at a time; switching sources kills the previous one.
let current = null;

/**
 * Turn a stream of stderr chunks into whole JSON lines.
 * Chunk boundaries fall mid-line often enough that naive per-chunk parsing
 * drops events.
 */
function makeLineParser(onLine) {
  let buffered = '';
  return (chunk) => {
    buffered += chunk.toString('utf8');
    let idx;
    while ((idx = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, idx).trim();
      buffered = buffered.slice(idx + 1);
      if (!line) continue;
      try {
        onLine(JSON.parse(line));
      } catch {
        // The helper only writes JSON, but never let a stray line kill capture.
      }
    }
  };
}

/**
 * List applications the helper can capture.
 * Always resolves; an unavailable or misbehaving helper yields [] so the picker
 * falls back to whole-system capture.
 *
 * @returns {Promise<Array<{deviceId: string, label: string}>>}
 */
async function listAppSources({ spawn = nodeSpawn, resolvePath = resolveAudioHostPath } = {}) {
  const exe = resolvePath();
  if (!exe) return [];

  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(exe, ['--list']);
    } catch {
      return resolve([]);
    }

    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.on('error', () => resolve([]));
    child.on('close', () => {
      try {
        const rows = JSON.parse(out);
        if (!Array.isArray(rows)) return resolve([]);
        resolve(
          rows
            .filter((r) => r && typeof r.id === 'string')
            .map((r) => ({ deviceId: `app:${r.id}`, label: r.label || r.exe || r.id }))
        );
      } catch {
        resolve([]);
      }
    });
  });
}

/**
 * Start capturing one application.
 *
 * @param {string} deviceId  `app:pid:<n>` as produced by listAppSources
 * @param {(pcm: Buffer) => void} onPcm
 * @param {(event: object) => void} onEvent
 * @returns {boolean} false when the helper is unavailable
 */
function startCapture(deviceId, onPcm, onEvent, { spawn = nodeSpawn, resolvePath = resolveAudioHostPath } = {}) {
  const exe = resolvePath();
  if (!exe) return false;

  // Leaving a previous helper alive would mix two applications into one stream.
  stopCapture();

  const target = String(deviceId).replace(/^app:/, '');
  let child;
  try {
    child = spawn(exe, ['--target', target]);
  } catch {
    return false;
  }

  current = child;
  child.stdout.on('data', (d) => onPcm(d));
  child.stderr.on('data', makeLineParser(onEvent));
  child.on('error', (err) => onEvent({ event: 'error', code: 'spawn_failed', message: err.message }));
  child.on('close', (code) => {
    if (current === child) current = null;
    onEvent({ event: 'exit', code });
  });
  return true;
}

/** Stop any running capture. Safe to call when nothing is running. */
function stopCapture() {
  if (!current) return;
  try {
    current.kill();
  } catch {
    // Already exited.
  }
  current = null;
}

module.exports = { listAppSources, startCapture, stopCapture };
