const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

// electron-builder afterPack hook.
// 1. Apply Electron Fuses (mirroring @electron-forge/plugin-fuses settings).
// 2. On darwin, ad-hoc sign the bundle ONLY when no real identity is configured.
//    Apple Silicon refuses to launch unsigned arm64 apps and macOS won't show
//    permission dialogs without at least an ad-hoc signature, so an unsigned
//    local build still needs this.
//
//    When CSC_NAME/CSC_LINK are set (CI, and local builds that opt in),
//    electron-builder signs the bundle itself, inside-out, after this hook
//    runs. Ad-hoc signing here would be overwritten at best and would fight
//    that at worst, so we skip it. The distinction matters: an ad-hoc
//    signature's designated requirement is a per-build cdhash, which is
//    exactly what stops Squirrel.Mac from ever accepting an update. See
//    docs/build/macos-auto-update.md.
module.exports = async function afterPack(context) {
  const isDarwin = context.electronPlatformName === 'darwin';
  const productFilename = context.packager.appInfo.productFilename;

  let execPath;
  let appBundlePath = null;
  if (isDarwin) {
    appBundlePath = path.join(context.appOutDir, `${productFilename}.app`);
    execPath = path.join(appBundlePath, 'Contents', 'MacOS', productFilename);
  } else {
    const executableName = context.packager.executableName || productFilename;
    execPath = path.join(context.appOutDir, executableName);
  }

  if (!fs.existsSync(execPath)) {
    throw new Error(`[electron-builder-fuses] Executable not found at ${execPath}`);
  }

  await flipFuses(execPath, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: false,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });

  console.log(`[electron-builder-fuses] Applied Fuses to ${execPath}`);

  if (isDarwin && appBundlePath) {
    // Keyed on the environment, not on build.mac.identity: that is pinned to a
    // name, and pinning it says nothing about whether the certificate is
    // actually in this machine's keychain. A developer without it would
    // otherwise get a bundle that is neither ad-hoc signed here nor signed by
    // electron-builder afterwards -- and an unsigned arm64 app will not launch.
    // When the certificate IS present locally, electron-builder simply replaces
    // this ad-hoc signature on its own pass.
    const hasRealIdentity = Boolean(process.env.CSC_NAME || process.env.CSC_LINK);
    if (hasRealIdentity) {
      console.log('[electron-builder-fuses] Real signing identity configured; ' +
        'leaving the bundle for electron-builder to sign inside-out');
    } else {
      console.log(`[electron-builder-fuses] No identity configured, ad-hoc signing ${appBundlePath}`);
      // --deep is wrong for distribution signing (Apple: "--deep Considered
      // Harmful"), but this path only produces a locally runnable build.
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', appBundlePath], { stdio: 'inherit' });
    }
  }
};
