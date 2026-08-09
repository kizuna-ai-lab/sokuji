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
 * `Google Chrome` + `pid:24088` -> `Google Chrome (24088)`.
 * Left alone when the id is not a pid, so a future helper keyed on something
 * else cannot end up with a meaningless number stapled to its name.
 */
function withPid(name, id) {
  const match = /^pid:(\d+)$/.exec(String(id));
  return match ? `${name} (${match[1]})` : name;
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
  if (!exe) {
    // Not an error on Linux, which has no helper. Everywhere else it means the
    // binary was never built - it is a build artifact, not a committed file -
    // and the only visible symptom would be a source list with nothing in it.
    if (process.platform !== 'linux') {
      console.warn(
        '[Sokuji] [AudioHost] Capture helper not found; per-application capture ' +
        'is unavailable. Run `npm run build:audio-host` (CI does this before packaging).'
      );
    }
    return [];
  }

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
            // appKey identifies the application across restarts, unlike the
            // pid inside deviceId. Windows reports an exe name, macOS a bundle
            // id; either is stable enough to re-find the app next launch.
            .map((r) => ({
              deviceId: `app:${r.id}`,
              // The pid rides in the name on every row, not only where two rows
              // would otherwise read alike. An application name is not unique -
              // a second Chrome profile is a second, separately capturable
              // Chrome - and a name that silently means "one of the two" is
              // worse than an ugly one. Composed here rather than in each
              // helper so Windows and macOS cannot drift apart; Linux taps
              // PipeWire nodes rather than processes and does not come through
              // this module at all.
              label: withPid(r.label || r.exe || r.id, r.id),
              appKey: r.exe || r.label || null,
              // A source is a process tree, and one tree can own several
              // windows that no OS here can capture separately. The row is
              // therefore named after the application, and its window titles
              // ride along for the UI to show on hover - otherwise two Chrome
              // windows look like one arbitrarily-chosen one. Absent on macOS,
              // where window titles cost the Screen Recording permission.
              windowTitles: Array.isArray(r.windows)
                ? r.windows.filter((t) => typeof t === 'string' && t.length > 0)
                : [],
            }))
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

  // 'desktop-audio-loopback' is the renderer's whole-system sentinel; the
  // helper spells that 'system'. Routing it here means macOS whole-system
  // capture uses a global Core Audio tap, which needs only the audio-capture
  // permission - getDisplayMedia would demand Screen Recording as well.
  const raw = String(deviceId);
  const target = raw === 'desktop-audio-loopback' ? 'system' : raw.replace(/^app:/, '');
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
