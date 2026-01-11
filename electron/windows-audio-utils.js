/**
 * Windows Audio Utilities for VB-CABLE support
 * Integrates with VB-CABLE installer for seamless setup
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');

/**
 * Create virtual audio devices on Windows using VB-CABLE
 * This function checks for VB-CABLE and offers installation if not present
 * @returns {Promise<boolean>} True if virtual devices can be used, false otherwise
 */
async function createVirtualAudioDevices() {
  try {
    console.log('[Sokuji] [Windows Audio] Checking for VB-CABLE virtual audio devices...');

    // First, do a quick check if VB-CABLE is installed
    const isInstalled = await isVBCableInstalled();

    if (isInstalled) {
      console.log('[Sokuji] [Windows Audio] VB-CABLE is already installed and ready');
      return true;
    }

    console.log('[Sokuji] [Windows Audio] VB-CABLE not detected, initiating installation flow...');

    // Import the installer module
    const installer = require('./vb-cable-installer');

    // Use the installer to check and potentially install VB-CABLE
    const vbCableReady = await installer.ensureVBCableInstalled();

    if (vbCableReady) {
      console.log('[Sokuji] [Windows Audio] VB-CABLE installation/setup completed successfully');
      return true;
    } else {
      console.log('[Sokuji] [Windows Audio] VB-CABLE not available (user declined or installation failed)');
      console.log('[Sokuji] [Windows Audio] Application will continue without virtual microphone support');
      return false;
    }
  } catch (error) {
    console.error('[Sokuji] [Windows Audio] Error setting up virtual audio devices:', error);
    return false;
  }
}

/**
 * Remove/disconnect virtual audio devices on Windows
 * Note: VB-CABLE devices are system-level and don't need cleanup
 */
function removeVirtualAudioDevices() {
  console.log('[Sokuji] [Windows Audio] Virtual audio device cleanup...');
  console.log('[Sokuji] [Windows Audio] Note: VB-CABLE devices are system-level and persist after application exit');
  // VB-CABLE doesn't require cleanup - it's a system driver
}

/**
 * Check if Windows audio system is available
 * @returns {Promise<boolean>} True if Windows audio is available, false otherwise
 */
async function isWindowsAudioAvailable() {
  try {
    // Simple check - if we're on Windows, audio is likely available
    // Actual device enumeration happens in the renderer process
    console.log('[Sokuji] [Windows Audio] Audio system check...');
    return true;
  } catch (error) {
    console.error('[Sokuji] [Windows Audio] Error checking audio availability:', error);
    return false;
  }
}

/**
 * Clean up any orphaned virtual audio connections
 * Note: VB-CABLE manages its own state, no cleanup needed
 * @returns {Promise<boolean>} Always returns true
 */
async function cleanupOrphanedDevices() {
  console.log('[Sokuji] [Windows Audio] Orphaned device check...');
  console.log('[Sokuji] [Windows Audio] VB-CABLE manages its own state automatically');
  return true;
}

/**
 * Check if VB-CABLE is installed by checking Windows audio devices
 * @returns {Promise<boolean>} True if VB-CABLE is installed and functional, false otherwise
 */
async function isVBCableInstalled() {
  try {
    console.log('[Sokuji] [Windows Audio] Checking VB-CABLE installation...');

    // Primary method: Check Windows audio devices using WMI (most reliable)
    try {
      const wmiCommand = 'wmic path Win32_SoundDevice get Name 2>nul';
      const { stdout } = await execPromise(wmiCommand);

      // Check if any audio device contains "CABLE" in its name
      if (stdout.includes('CABLE')) {
        console.log('[Sokuji] [Windows Audio] VB-CABLE audio device found in system');

        // Get more details about the CABLE device
        try {
          const detailCommand = 'wmic path Win32_SoundDevice where "Name like \'%CABLE%\'" get Name,Status 2>nul';
          const { stdout: details } = await execPromise(detailCommand);
          console.log('[Sokuji] [Windows Audio] VB-CABLE device details:', details.trim());

          // Check if status is OK
          if (details.includes('OK')) {
            console.log('[Sokuji] [Windows Audio] VB-CABLE device status is OK');
          }
        } catch (detailError) {
          // Details query failed, but device exists
        }

        return true;
      }
    } catch (wmiError) {
      console.log('[Sokuji] [Windows Audio] WMI query failed:', wmiError.message);
    }

    // Backup method 1: Check using PowerShell audio endpoints
    try {
      const psCommand = `powershell -Command "Get-PnpDevice -Class AudioEndpoint | Where-Object {$_.FriendlyName -like '*CABLE*'} | Select-Object -Property FriendlyName"`;
      const { stdout } = await execPromise(psCommand);

      if (stdout.includes('CABLE')) {
        console.log('[Sokuji] [Windows Audio] VB-CABLE found via PowerShell audio endpoints');
        return true;
      }
    } catch (psError) {
      console.log('[Sokuji] [Windows Audio] PowerShell endpoint query failed:', psError.message);
    }

    // Backup method 2: Check if VB-CABLE service exists
    try {
      const serviceCommand = 'sc query VBAudioVACWDM 2>nul';
      const { stdout } = await execPromise(serviceCommand);

      if (stdout.includes('RUNNING')) {
        console.log('[Sokuji] [Windows Audio] VB-CABLE service is running');
        return true;
      } else if (stdout.includes('STOPPED')) {
        console.log('[Sokuji] [Windows Audio] VB-CABLE service exists but is stopped');
        // Try to start the service
        try {
          await execPromise('sc start VBAudioVACWDM 2>nul');
          console.log('[Sokuji] [Windows Audio] Started VB-CABLE service');
        } catch (startError) {
          console.log('[Sokuji] [Windows Audio] Could not start VB-CABLE service (may require admin rights)');
        }
        return true;
      }
    } catch (serviceError) {
      // Service not found
    }

    // Backup method 3: Alternative WMI query using PowerShell
    try {
      const psWmiCommand = `powershell -Command "Get-WmiObject Win32_SoundDevice | Where-Object {$_.Name -like '*CABLE*'} | Select-Object -Property Name"`;
      const { stdout } = await execPromise(psWmiCommand);

      if (stdout.includes('CABLE')) {
        console.log('[Sokuji] [Windows Audio] VB-CABLE found via PowerShell WMI query');
        return true;
      }
    } catch (psWmiError) {
      console.log('[Sokuji] [Windows Audio] PowerShell WMI query failed:', psWmiError.message);
    }

    console.log('[Sokuji] [Windows Audio] VB-CABLE not detected by any method');
    return false;
  } catch (error) {
    console.error('[Sokuji] [Windows Audio] Error checking VB-CABLE installation:', error);
    return false;
  }
}

/**
 * Get VB-CABLE information
 * Note: This is a placeholder - actual detection happens in renderer process
 * @returns {Promise<Object>} Basic info structure
 */
async function getVBCableInfo() {
  return {
    installed: false,
    version: null,
    devices: [],
    note: 'VB-CABLE detection is handled by the renderer process using MediaDevices API'
  };
}

/**
 * Get audio devices
 * Note: This is a placeholder - actual enumeration happens in renderer process
 * @returns {Promise<{inputs: Array, outputs: Array}>} Empty device lists
 */
async function getAudioDevices() {
  console.log('[Sokuji] [Windows Audio] Device enumeration deferred to renderer process');
  return {
    inputs: [],
    outputs: [],
    note: 'Device enumeration is handled by the renderer process using MediaDevices API'
  };
}

// ============================================================================
// System Audio Capture Functions (Windows via desktopCapturer)
// ============================================================================

/**
 * Check if system audio capture is supported
 * On Windows, this is always true when running in Electron (uses desktopCapturer loopback)
 * @returns {Promise<boolean>} True if system audio capture is supported
 */
async function supportsSystemAudioCapture() {
  console.log('[Sokuji] [Windows Audio] System audio capture is supported via desktopCapturer loopback');
  return true;
}

/**
 * List available system audio sources
 * On Windows, we provide a single "System Audio" source that captures all system audio
 * via the desktopCapturer loopback feature
 * @returns {Promise<Array<{deviceId: string, label: string}>>} Array of system audio sources
 */
async function listSystemAudioSources() {
  console.log('[Sokuji] [Windows Audio] Listing system audio sources');
  // Windows captures ALL system audio via loopback, so we return a single source
  return [{
    deviceId: 'desktop-audio-loopback',
    label: 'System Audio (All Applications)'
  }];
}

/**
 * Connect to a system audio source
 * On Windows, this is a no-op since the actual capture is done via getDisplayMedia in the renderer
 * @param {string} sourceId - The source ID to connect to
 * @returns {Promise<{success: boolean, error?: string}>} Result object
 */
async function connectSystemAudioSource(sourceId) {
  console.log(`[Sokuji] [Windows Audio] Connect system audio source: ${sourceId}`);
  // On Windows, the "connection" happens when getDisplayMedia is called in the renderer
  // This function just acknowledges the intent to capture
  return { success: true };
}

/**
 * Disconnect from the current system audio source
 * On Windows, this is a no-op since cleanup happens in the renderer
 * @returns {Promise<{success: boolean}>} Result object
 */
async function disconnectSystemAudioSource() {
  console.log('[Sokuji] [Windows Audio] Disconnect system audio source');
  // Cleanup happens in the renderer when the MediaStream is stopped
  return { success: true };
}

module.exports = {
  createVirtualAudioDevices,
  removeVirtualAudioDevices,
  isWindowsAudioAvailable,
  cleanupOrphanedDevices,
  isVBCableInstalled,
  getVBCableInfo,
  getAudioDevices,
  // System audio capture functions
  supportsSystemAudioCapture,
  listSystemAudioSources,
  connectSystemAudioSource,
  disconnectSystemAudioSource
};