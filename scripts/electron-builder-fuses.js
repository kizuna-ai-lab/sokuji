const path = require('path');
const fs = require('fs');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

// Apply Electron Fuses to the packaged binary, mirroring the options
// previously set by @electron-forge/plugin-fuses in forge.config.js.
module.exports = async function applyFuses(context) {
  const executableName = context.packager.executableName || context.packager.appInfo.productFilename;
  const execPath = path.join(context.appOutDir, executableName);

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
};
