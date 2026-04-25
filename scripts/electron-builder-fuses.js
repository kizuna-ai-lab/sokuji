const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

// electron-builder afterPack hook.
// 1. Apply Electron Fuses (mirroring @electron-forge/plugin-fuses settings).
// 2. On darwin, ad-hoc sign the bundle. electron-builder skips signing entirely
//    when no identity is configured, but Apple Silicon refuses to launch
//    unsigned arm64 apps and macOS won't show permission dialogs without at
//    least an ad-hoc signature.
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
    console.log(`[electron-builder-fuses] Ad-hoc signing ${appBundlePath}`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appBundlePath], { stdio: 'inherit' });
  }
};
