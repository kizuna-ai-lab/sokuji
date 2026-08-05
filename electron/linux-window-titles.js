/**
 * Map audio-producing processes to human-readable window titles on Linux X11
 * (issue #335).
 *
 * PipeWire nodes carry no window title - a Chromium tab playing YouTube reports
 * `application.name = "Chromium"` and `media.name = "Playback"`, which is not
 * enough to tell two browser windows apart. X11 does know the titles, so we ask
 * it and join on process id.
 *
 * The join needs a process walk: the PipeWire stream belongs to Chromium's
 * audio service child (`chrome --type=utility --utility-sub-type=audio...`)
 * while the window belongs to its parent browser process. Walking up the ppid
 * chain bridges the two.
 *
 * Everything here is best-effort. Wayland exposes no equivalent client list and
 * xprop may not be installed, in which case callers keep the plain application
 * name.
 */
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileP = promisify(execFile);

// Chromium's audio service is one hop from the browser process; allow a little
// more for wrappers (snap, flatpak) without ever risking a long walk.
const MAX_PARENT_HOPS = 6;

/** Parent pid of a process, or null. Reads /proc directly - no shell. */
function parentPidOf(pid, { readFileSync = fs.readFileSync } = {}) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // The comm field is parenthesised and may itself contain spaces, so split
    // after the closing paren rather than tokenising the whole line.
    const after = stat.slice(stat.lastIndexOf(')') + 2);
    const ppid = Number.parseInt(after.split(' ')[1], 10);
    return Number.isInteger(ppid) && ppid > 0 ? ppid : null;
  } catch {
    return null;
  }
}

/** Parse `xprop -root _NET_CLIENT_LIST` into window ids. */
function parseClientList(stdout) {
  const hash = stdout.indexOf('#');
  if (hash < 0) return [];
  return stdout
    .slice(hash + 1)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^0x[0-9a-fA-F]+$/.test(s));
}

/** Parse an `xprop -id <win> _NET_WM_PID` line into a pid. */
function parseWindowPid(stdout) {
  const m = stdout.match(/=\s*(\d+)/);
  return m ? Number.parseInt(m[1], 10) : null;
}

/** Parse an `xprop -id <win> _NET_WM_NAME` line into a title. */
function parseWindowName(stdout) {
  const m = stdout.match(/=\s*"([\s\S]*)"\s*$/);
  return m ? m[1] : null;
}

/**
 * pid -> window title for every top-level X11 window.
 * Resolves to an empty Map on Wayland, without xprop, or on any failure.
 * @returns {Promise<Map<number, string>>}
 */
async function listWindowTitles({ run = execFileP, display } = {}) {
  const titles = new Map();
  // Read the env inside rather than as a default parameter: a default fires on
  // an explicitly-passed undefined too, which would silently reach for the real
  // DISPLAY when a caller meant "there isn't one".
  const target = display !== undefined ? display : process.env.DISPLAY;
  if (!target) return titles;

  const xprop = (args) => run('xprop', ['-display', target, ...args]);

  let ids;
  try {
    const { stdout } = await xprop(['-root', '_NET_CLIENT_LIST']);
    ids = parseClientList(stdout);
  } catch {
    return titles; // no xprop, or a compositor without _NET_CLIENT_LIST
  }

  for (const id of ids) {
    try {
      const [{ stdout: pidOut }, { stdout: nameOut }] = await Promise.all([
        xprop(['-id', id, '_NET_WM_PID']),
        xprop(['-id', id, '_NET_WM_NAME']),
      ]);
      const pid = parseWindowPid(pidOut);
      const name = parseWindowName(nameOut);
      // First window of a process wins; later ones are usually secondary.
      if (pid && name && !titles.has(pid)) titles.set(pid, name);
    } catch {
      // Window vanished between listing and querying - skip it.
    }
  }
  return titles;
}

/**
 * Window title for the process that owns `pid`, walking up the parent chain.
 * Returns null when no ancestor owns a window.
 * @returns {string|null}
 */
function titleForPid(pid, titles, deps = {}) {
  let current = pid;
  for (let hop = 0; current && hop < MAX_PARENT_HOPS; hop++) {
    const title = titles.get(current);
    if (title) return title;
    current = parentPidOf(current, deps);
    if (current === 1) break; // reached init; nothing useful above
  }
  return null;
}

module.exports = {
  listWindowTitles,
  titleForPid,
  parentPidOf,
  parseClientList,
  parseWindowPid,
  parseWindowName,
  MAX_PARENT_HOPS,
};
