// Platform decisions for the update flow, kept free of electron and
// electron-updater imports so they can be tested directly.
//
// Which platforms can apply an update in place comes down to what Squirrel
// requires of the signature. Squirrel.Mac captures the designated requirement
// of the *running* bundle and verifies each update against it; an ad-hoc
// signature's DR is a per-build cdhash, so it can never match, which is why
// macOS was notify-only. Signing with a stable certificate — it does not have
// to be an Apple one — makes that check pass. See
// docs/build/macos-auto-update.md.

const RELEASE_BASE = 'https://github.com/kizuna-ai-lab/sokuji/releases';

/**
 * Does this platform hand the download and install to electron-updater,
 * rather than fetching an installer itself or sending the user to a browser?
 *
 * @param {{platform: string, isAppImage?: boolean}} env
 * @returns {boolean}
 */
function usesNativeUpdaterFlow({ platform, isAppImage = false }) {
  if (platform === 'darwin') return true;
  if (platform === 'linux') return Boolean(isAppImage);
  // Windows downloads the Squirrel Setup.exe itself: Forge's Squirrel.Windows
  // output is not electron-updater compatible.
  return false;
}

/**
 * Build the `update-available` payload sent to the renderer.
 *
 * @param {{version: string, releaseNotes?: unknown}} info  electron-updater's UpdateInfo
 * @param {{platform: string, arch: string, isAppImage?: boolean}} env
 */
function buildUpdatePayload(info, { platform, arch, isAppImage = false }) {
  // With fullChangelog=true, releaseNotes is an array of {version, note} objects
  // where note is already HTML (rendered by GitHub). Sorted newest-first.
  let releaseNotes;
  if (Array.isArray(info.releaseNotes)) {
    releaseNotes = info.releaseNotes;
  } else if (typeof info.releaseNotes === 'string') {
    releaseNotes = info.releaseNotes;
  } else {
    releaseNotes = '';
  }

  const version = info.version;
  const payload = { status: 'available', version, releaseNotes };

  if (platform === 'linux') {
    // electron-builder names AppImage artifacts with `x86_64` (not `x64`) for
    // x64 Linux builds, and `arm64` for arm64. Translate Node's process.arch.
    const appImageArch = arch === 'x64' ? 'x86_64' : 'arm64';
    const debArch = arch === 'x64' ? 'amd64' : 'arm64';
    const base = `${RELEASE_BASE}/download/v${version}`;

    payload.supportsAutoUpdate = Boolean(isAppImage);
    payload.appImageUrl = `${base}/Sokuji-${version}-${appImageArch}.AppImage`;
    payload.debUrl = `${base}/sokuji_${version}_${debArch}.deb`;
    payload.releasePageUrl = `${RELEASE_BASE}/tag/v${version}`;
    // Legacy field kept for Windows / backward compat callers of updateStore:
    if (!isAppImage) {
      payload.downloadUrl = payload.releasePageUrl;
    }
  } else if (platform === 'darwin') {
    // Nothing platform-specific beyond the flag. In particular no downloadUrl:
    // UpdateDialog renders a browser-download button whenever one is present,
    // which would hide the in-app flow.
    payload.supportsAutoUpdate = true;
  }

  return payload;
}

module.exports = { buildUpdatePayload, usesNativeUpdaterFlow };
