// Recognise per-application capture rows that are the running Sokuji app itself.
//
// Every platform's participant-source list is "applications playing audio",
// and Sokuji plays audio: its own translated TTS. Offering Sokuji as a
// participant source lets the user capture that TTS and feed it straight back
// into translation, a self-sustaining loop. The native helpers only exclude
// their *own* short-lived process — they cannot know which app spawned them —
// so the exclusion lives here, in the main-process listing layer, which does.
//
// Deliberately does not require('electron') at load time so it stays unit
// testable (same reasoning as sandbox-recovery.js); the Electron-aware parts
// are gathered lazily inside currentSelfIdentity().

/**
 * Lowercased executable basename with any .exe suffix removed.
 *
 * The Windows helper reports bare image names ("Sokuji.exe"), PipeWire bare
 * binary names ("sokuji"), and process.execPath is a full path on either
 * separator convention — none of which carries identity beyond the name.
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeExeName(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const base = value.split(/[\\/]/).pop().toLowerCase();
  const stripped = base.endsWith('.exe') ? base.slice(0, -'.exe'.length) : base;
  return stripped.length > 0 ? stripped : null;
}

/**
 * Build the identity rows are matched against. Pure, for tests; the live
 * gathering is currentSelfIdentity().
 * @param {{execPath?: string, pids?: Iterable<number>, appName?: string|null}} parts
 * @returns {{pids: Set<number>, exeName: string|null, appName: string|null}}
 */
function makeSelfIdentity({ execPath = process.execPath, pids = [process.pid], appName = null } = {}) {
  const normalizedName = typeof appName === 'string' && appName.trim().length > 0
    ? appName.trim().toLowerCase()
    : null;
  return { pids: new Set(pids), exeName: normalizeExeName(execPath), appName: normalizedName };
}

/**
 * Identity of the running app, gathered fresh per listing: Electron's child
 * processes (the audio service among them) come and go, so a snapshot taken
 * at module load would go stale.
 * @returns {{pids: Set<number>, exeName: string|null, appName: string|null}}
 */
function currentSelfIdentity() {
  const pids = [process.pid];
  let appName = null;
  try {
    // Lazy on purpose — unit tests and the helper-less web build run this
    // module outside Electron, where the require throws.
    const { app } = require('electron');
    if (app) {
      // Renderer, GPU and utility processes all play as "us"; on Linux the
      // audio actually comes from Chromium's audio-service utility process,
      // whose pid is what PipeWire reports.
      for (const metric of app.getAppMetrics()) pids.push(metric.pid);
      appName = app.name || null;
    }
  } catch {
    // Outside Electron process.pid and execPath are still the right identity.
  }
  return makeSelfIdentity({ pids, appName });
}

/**
 * Whether one listed application row is the running app itself.
 *
 * Three signals, any of which decides:
 *  - pid membership in our process tree (macOS reports the bundle's pid,
 *    Linux the audio-service utility's — both are in the set);
 *  - executable name equal to ours (Windows image name, Linux binary; in a
 *    dev run this is "electron", so another bare-electron dev app would be
 *    hidden too — a dev-only cost accepted over ever listing ourselves);
 *  - application name exactly equal to ours (macOS, where the row's exe is a
 *    bundle id). Exact equality only: a third-party app whose name merely
 *    contains "Sokuji" is not us.
 *
 * @param {{pid?: number|null, exe?: string|null, label?: string|null}} row
 * @param {{pids: Set<number>, exeName: string|null, appName: string|null}} self
 * @returns {boolean}
 */
function isOwnAppSource(row, self) {
  if (!row || !self) return false;
  if (typeof row.pid === 'number' && self.pids?.has(row.pid)) return true;
  const exe = normalizeExeName(row.exe);
  if (exe && self.exeName && exe === self.exeName) return true;
  const label = typeof row.label === 'string' ? row.label.trim().toLowerCase() : null;
  if (label && self.appName && label === self.appName) return true;
  return false;
}

module.exports = { isOwnAppSource, makeSelfIdentity, currentSelfIdentity };
