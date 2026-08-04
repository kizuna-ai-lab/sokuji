// Locate the per-application audio capture helper (issue #335).
//
// The binary is a committed build artifact shipped through forge's
// `extraResource: ['assets', 'resources']`, so a packaged app finds it under
// <resourcesPath>/resources/bin/... while development finds it in the repo tree.
const path = require('path');
const fsDefault = require('fs');

/**
 * Per-platform location of the helper. macOS ships one binary per architecture
 * because Apple Silicon and Intel cannot share a Mach-O built this way.
 */
function relPathFor(platform, arch) {
  if (platform === 'win32') {
    return path.join('resources', 'bin', 'win32-x64', 'sokuji-audio-host.exe');
  }
  if (platform === 'darwin') {
    const dir = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
    return path.join('resources', 'bin', dir, 'sokuji-audio-host');
  }
  return null;
}

// Kept for callers that only care about the Windows layout.
const AUDIO_HOST_REL_PATH = relPathFor('win32');

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
  arch = process.arch,
  resourcesPath = process.resourcesPath,
  appPath = path.join(__dirname, '..'),
  existsSync = fsDefault.existsSync,
} = {}) {
  const rel = relPathFor(platform, arch);
  if (!rel) return null;   // Linux taps PipeWire directly; no helper binary.

  const candidates = [
    resourcesPath ? path.join(resourcesPath, rel) : null,
    path.join(appPath, rel),
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

module.exports = { resolveAudioHostPath, relPathFor, AUDIO_HOST_REL_PATH };
