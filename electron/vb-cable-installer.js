const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const { app, dialog } = require('electron');

/**
 * Download file from URL
 * @param {string} url - URL to download from
 * @param {string} destPath - Destination file path
 * @returns {Promise<void>}
 */
async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = require('fs').createWriteStream(destPath);

    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        https.get(response.headers.location, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => {
            file.close(resolve);
          });
        }).on('error', (err) => {
          require('fs').unlink(destPath, () => {});
          reject(err);
        });
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      }
    }).on('error', (err) => {
      require('fs').unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * Wait for VB-CABLE installation to complete
 * @param {number} maxAttempts - Maximum number of checks
 * @param {number} interval - Interval between checks in milliseconds
 * @returns {Promise<boolean>} - True if installation detected
 */
async function waitForInstallation(maxAttempts = 30, interval = 2000) {
  console.log('[Sokuji] [VB-CABLE Installer] Waiting for installation to complete...');

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, interval));

    const { isVBCableInstalled } = require('./windows-audio-utils');
    if (await isVBCableInstalled()) {
      console.log('[Sokuji] [VB-CABLE Installer] Installation detected successfully');
      return true;
    }

    if (i % 5 === 0 && i > 0) {
      console.log(`[Sokuji] [VB-CABLE Installer] Still waiting... (${i * interval / 1000}s elapsed)`);
    }
  }

  // If automated detection fails, ask the user
  if (maxAttempts > 5) {
    const result = await dialog.showMessageBox({
      type: 'question',
      title: 'Installation Status',
      message: 'Is the VB-CABLE installation complete?',
      detail: 'The installer may still be running. Please check if the installation wizard has finished.',
      buttons: ['Yes, installation completed', 'No, installation failed', 'Still installing...'],
      defaultId: 0,
      cancelId: 1
    });

    if (result.response === 0) {
      return true;
    } else if (result.response === 2) {
      // Continue waiting
      return await waitForInstallation(15, 2000);
    }
  }

  return false;
}

/**
 * Clean up temporary files
 * @param {string} tempDir - Path to temporary directory
 */
async function cleanupTempFiles(tempDir) {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log('[Sokuji] [VB-CABLE Installer] Temporary files cleaned up');
  } catch (cleanupError) {
    console.warn('[Sokuji] [VB-CABLE Installer] Could not clean up temp files:', cleanupError);
  }
}

/**
 * Check if running with administrator privileges (kept for reference, not used in new flow)
 * @returns {Promise<boolean>}
 */
async function isAdmin() {
  try {
    await execPromise('net session');
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Download and install VB-CABLE
 * @param {boolean} silent - Whether to install silently
 * @returns {Promise<boolean>} - True if installation successful
 */
async function installVBCable(silent = false) {
  try {
    console.log('[Sokuji] [VB-CABLE Installer] Starting VB-CABLE installation process...');

    // Check if already installed using the shared detection function
    const { isVBCableInstalled } = require('./windows-audio-utils');
    if (await isVBCableInstalled()) {
      console.log('[Sokuji] [VB-CABLE Installer] VB-CABLE is already installed');
      return true;
    }

    // Note: We no longer check for admin privileges here
    // Windows UAC will automatically prompt for elevation when needed
    console.log('[Sokuji] [VB-CABLE Installer] Preparing installation (Windows will handle UAC if needed)...');

    // Create temp directory
    const tempDir = path.join(app.getPath('temp'), 'sokuji-vbcable');
    await fs.mkdir(tempDir, { recursive: true });

    // Download VB-CABLE
    const vbCableUrl = 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip';
    const zipPath = path.join(tempDir, 'vbcable.zip');

    console.log('[Sokuji] [VB-CABLE Installer] Downloading VB-CABLE...');
    await downloadFile(vbCableUrl, zipPath);

    // Extract the ZIP file
    console.log('[Sokuji] [VB-CABLE Installer] Extracting VB-CABLE...');
    const extractCmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tempDir}' -Force"`;
    await execPromise(extractCmd);

    // Find the appropriate installer based on system architecture
    const is64Bit = process.arch === 'x64';
    const installerName = is64Bit ? 'VBCABLE_Setup_x64.exe' : 'VBCABLE_Setup.exe';
    const installerPath = path.join(tempDir, installerName);

    // Check if installer exists
    try {
      await fs.access(installerPath);
    } catch (error) {
      console.error('[Sokuji] [VB-CABLE Installer] Installer not found at:', installerPath);
      return false;
    }

    // Run the installer - Windows will automatically show UAC prompt if needed
    console.log('[Sokuji] [VB-CABLE Installer] Launching installer:', installerPath);

    const { shell, dialog } = require('electron');

    if (silent) {
      // Silent installation using PowerShell to trigger UAC
      console.log('[Sokuji] [VB-CABLE Installer] Attempting silent installation...');

      try {
        // Use PowerShell Start-Process to run with elevation
        const psCommand = `Start-Process -FilePath "${installerPath}" -ArgumentList "-i","-h" -Verb RunAs -Wait -PassThru | ForEach-Object { $_.ExitCode }`;
        const { stdout } = await execPromise(`powershell -Command "${psCommand}"`);

        console.log('[Sokuji] [VB-CABLE Installer] Installation process completed');

        // Check if installation was successful
        const installed = await waitForInstallation(5, 2000);
        if (installed) {
          console.log('[Sokuji] [VB-CABLE Installer] VB-CABLE installed successfully');
          cleanupTempFiles(tempDir);
          return true;
        }
      } catch (error) {
        console.error('[Sokuji] [VB-CABLE Installer] Silent installation failed:', error);
        // Fall back to interactive installation
        console.log('[Sokuji] [VB-CABLE Installer] Falling back to interactive installation...');
      }
    }

    // Interactive installation - trigger UAC properly
    console.log('[Sokuji] [VB-CABLE Installer] Launching installer with UAC elevation...');

    try {
      // Use PowerShell to run installer with UAC prompt
      const psCommand = `Start-Process -FilePath "${installerPath}" -Verb RunAs`;
      await execPromise(`powershell -Command "${psCommand}"`);

      console.log('[Sokuji] [VB-CABLE Installer] Installer launched with elevation request');
    } catch (error) {
      if (error.message && error.message.includes('canceled')) {
        console.log('[Sokuji] [VB-CABLE Installer] User cancelled UAC prompt');
        cleanupTempFiles(tempDir);
        return false;
      }

      // If PowerShell method fails, try VBScript alternative
      console.warn('[Sokuji] [VB-CABLE Installer] PowerShell method failed, trying VBScript alternative...');

      try {
        // Create VBS script to request administrator privileges
        const vbsContent = `Set UAC = CreateObject("Shell.Application")\nUAC.ShellExecute "${installerPath.replace(/\\/g, '\\\\')}", "", "", "runas", 1`;
        const vbsPath = path.join(tempDir, 'run_as_admin.vbs');
        await fs.writeFile(vbsPath, vbsContent);
        await execPromise(`cscript //NoLogo "${vbsPath}"`);

        console.log('[Sokuji] [VB-CABLE Installer] Installer launched via VBScript with elevation');
      } catch (vbsError) {
        console.error('[Sokuji] [VB-CABLE Installer] All elevation methods failed:', vbsError);

        // Last resort: just try to run it normally and hope for the best
        await shell.openPath(installerPath);
        console.log('[Sokuji] [VB-CABLE Installer] Fallback: Opened installer without explicit elevation');
      }
    }

    // Show user guidance
    const guidanceResult = await dialog.showMessageBox({
      type: 'info',
      title: 'VB-CABLE Installation',
      message: 'VB-CABLE installer has been launched.',
      detail: 'Please follow these steps:\n' +
              '1. Click "Yes" if Windows asks for administrator permission\n' +
              '2. Follow the installation wizard\n' +
              '3. Click "Install" in the VB-CABLE setup\n' +
              '4. Wait for installation to complete\n' +
              '5. Click OK below when done',
      buttons: ['OK, I\'ll install it', 'Cancel'],
      defaultId: 0,
      cancelId: 1
    });

    if (guidanceResult.response === 1) {
      console.log('[Sokuji] [VB-CABLE Installer] User cancelled installation');
      cleanupTempFiles(tempDir);
      return false;
    }

    // Wait for user to complete installation
    const installed = await waitForInstallation();

    if (installed) {
      console.log('[Sokuji] [VB-CABLE Installer] VB-CABLE installed successfully');

      await dialog.showMessageBox({
        type: 'info',
        title: 'Installation Complete',
        message: 'VB-CABLE has been installed successfully!',
        detail: 'The virtual audio devices are now available for use.',
        buttons: ['OK']
      });

      cleanupTempFiles(tempDir);
      return true;
    } else {
      console.error('[Sokuji] [VB-CABLE Installer] VB-CABLE installation failed or was cancelled');
      cleanupTempFiles(tempDir);
      return false;
    }
  } catch (error) {
    console.error('[Sokuji] [VB-CABLE Installer] Installation failed:', error);
    return false;
  }
}

/**
 * Show VB-CABLE installation prompt to user
 * @returns {Promise<boolean>} - True if user wants to install
 */
async function promptVBCableInstallation() {
  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'VB-CABLE Required',
    message: 'VB-CABLE virtual audio driver is required for virtual microphone functionality.',
    detail: 'Would you like to download and install VB-CABLE now? This requires administrator privileges.',
    buttons: ['Install Now', 'Download Manually', 'Cancel'],
    defaultId: 0,
    cancelId: 2
  });

  if (result.response === 0) {
    // Install Now
    return true;
  } else if (result.response === 1) {
    // Download Manually - open browser
    const { shell } = require('electron');
    shell.openExternal('https://vb-audio.com/Cable/');
    return false;
  } else {
    // Cancel
    return false;
  }
}

/**
 * Handle VB-CABLE installation flow
 * @returns {Promise<boolean>} - True if VB-CABLE is available
 */
async function ensureVBCableInstalled() {
  try {
    const { isVBCableInstalled } = require('./windows-audio-utils');

    // Check if already installed
    if (await isVBCableInstalled()) {
      console.log('[Sokuji] [VB-CABLE Installer] VB-CABLE is already installed');
      return true;
    }

    // Prompt user for installation
    const shouldInstall = await promptVBCableInstallation();

    if (shouldInstall) {
      // Attempt installation
      const installed = await installVBCable(false);

      if (installed) {
        dialog.showMessageBox({
          type: 'info',
          title: 'Installation Complete',
          message: 'VB-CABLE has been installed successfully.',
          detail: 'You may need to restart the application for the changes to take effect.',
          buttons: ['OK']
        });

        return true;
      } else {
        dialog.showErrorBox(
          'Installation Failed',
          'VB-CABLE installation failed. Please try installing manually from https://vb-audio.com/Cable/'
        );
        return false;
      }
    }

    return false;
  } catch (error) {
    console.error('[Sokuji] [VB-CABLE Installer] Error in installation flow:', error);
    return false;
  }
}

/**
 * Get VB-CABLE download URL
 * @returns {string} - Download URL
 */
function getVBCableDownloadUrl() {
  return 'https://vb-audio.com/Cable/';
}

/**
 * Get VB-CABLE installation instructions
 * @returns {string} - Installation instructions
 */
function getInstallationInstructions() {
  return `
VB-CABLE Installation Instructions:

1. Download VB-CABLE from: https://vb-audio.com/Cable/
2. Extract the ZIP file
3. Run the appropriate installer:
   - For 64-bit Windows: VBCABLE_Setup_x64.exe
   - For 32-bit Windows: VBCABLE_Setup.exe
4. Run as Administrator
5. Follow the installation wizard
6. Restart your computer if prompted
7. After installation, restart Sokuji

The virtual microphone will appear as "CABLE Output" in recording devices.
The virtual speaker will appear as "CABLE Input" in playback devices.
`;
}

module.exports = {
  installVBCable,
  promptVBCableInstallation,
  ensureVBCableInstalled,
  getVBCableDownloadUrl,
  getInstallationInstructions
};