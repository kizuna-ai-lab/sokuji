// electron/distribution-channel.js
//
// Which build this is: the website's installer or the Microsoft Store's
// (spec 2026-10-17 §1). The Store's installer is the website's packaged app
// with one file added, resources/distribution.json, because Store policy
// 10.2.3 forbids offering to install other software (the VB-CABLE driver).
//
// The in-app updater installs the website's build over a Store install, and
// that build has no marker, so the first launch of a marked build records the
// channel in userData and every later launch reads it from there. Only
// `store` is ever recorded. Nothing here throws: an unreadable file is an
// absent one.
const fsDefault = require('fs');
const path = require('path');

const MARKER_FILE = 'distribution.json';
const STORE_MARKER = { channel: 'store' };

function isStoreMarker(file, fs) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data !== null && typeof data === 'object' && data.channel === STORE_MARKER.channel;
  } catch {
    return false;
  }
}

/**
 * @returns {'website' | 'store'}
 */
function resolveDistributionChannel({ resourcesPath = process.resourcesPath, userDataPath, fs = fsDefault } = {}) {
  const recorded = userDataPath ? path.join(userDataPath, MARKER_FILE) : null;
  if (resourcesPath && isStoreMarker(path.join(resourcesPath, MARKER_FILE), fs)) {
    if (recorded && !isStoreMarker(recorded, fs)) {
      try {
        fs.mkdirSync(userDataPath, { recursive: true });
        fs.writeFileSync(recorded, `${JSON.stringify(STORE_MARKER)}\n`);
      } catch (error) {
        console.warn('[Sokuji] [Distribution] Could not record the Store channel:', error?.message);
      }
    }
    return 'store';
  }
  return recorded && isStoreMarker(recorded, fs) ? 'store' : 'website';
}

module.exports = { resolveDistributionChannel, MARKER_FILE, STORE_MARKER };
