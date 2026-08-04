// Locate the per-application audio capture helper (issue #335).
//
// The binary is a committed build artifact shipped through forge's
// `extraResource: ['assets', 'resources']`, so a packaged app finds it under
// <resourcesPath>/resources/bin/... while development finds it in the repo tree.
const path = require('path');
const fsDefault = require('fs');

const AUDIO_HOST_REL_PATH = path.join('resources', 'bin', 'win32-x64', 'sokuji-audio-host.exe');

/**
 * Resolve the capture helper's absolute path.
 *
 * Returns null - never throws - when the platform is unsupported or the binary
 * is missing, so callers degrade to whole-system capture instead of failing the
 * session.
 *
 * @returns {string|null}
 */
function resolveAudioHostPath({
  platform = process.platform,
  resourcesPath = process.resourcesPath,
  appPath = path.join(__dirname, '..'),
  existsSync = fsDefault.existsSync,
} = {}) {
  if (platform !== 'win32') return null;

  const candidates = [
    resourcesPath ? path.join(resourcesPath, AUDIO_HOST_REL_PATH) : null,
    path.join(appPath, AUDIO_HOST_REL_PATH),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // A malformed path must not take the audio pipeline down with it.
    }
  }
  return null;
}

module.exports = { resolveAudioHostPath, AUDIO_HOST_REL_PATH };
