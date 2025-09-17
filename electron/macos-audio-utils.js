/**
 * macOS Audio Utilities for BlackHole virtual audio support
 * Provides virtual microphone functionality using BlackHole audio driver
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');

/**
 * Create virtual audio devices on macOS using Sokuji Virtual Audio
 * This function checks if our bundled driver is installed by the PKG installer
 * @returns {Promise<boolean>} True if virtual devices can be used, false otherwise
 */
async function createVirtualAudioDevices() {
  try {
    console.log('[Sokuji] [macOS Audio] Checking for Sokuji Virtual Audio devices...');

    // Check if our custom driver is installed
    const isInstalled = await isSokujiVirtualAudioInstalled();

    if (isInstalled) {
      console.log('[Sokuji] [macOS Audio] Sokuji Virtual Audio is installed and ready');
      return true;
    }

    console.log('[Sokuji] [macOS Audio] Sokuji Virtual Audio not detected');
    console.log('[Sokuji] [macOS Audio] Virtual audio driver not found. This may happen if:');
    console.log('[Sokuji] [macOS Audio] - The application was not installed via the official PKG installer');
    console.log('[Sokuji] [macOS Audio] - The PKG installer driver installation failed');
    console.log('[Sokuji] [macOS Audio] - macOS security settings blocked the driver');
    console.log('[Sokuji] [macOS Audio] - System requires restart to load the driver');
    console.log('[Sokuji] [macOS Audio] Please reinstall Sokuji using the official PKG installer');
    console.log('[Sokuji] [macOS Audio] If the problem persists, try restarting your Mac');
    console.log('[Sokuji] [macOS Audio] Application will continue without virtual microphone support');
    return false;
  } catch (error) {
    console.error('[Sokuji] [macOS Audio] Error checking virtual audio devices:', error);
    return false;
  }
}

/**
 * Remove/disconnect virtual audio devices on macOS
 * Note: Sokuji Virtual Audio devices are system-level and don't need cleanup
 */
function removeVirtualAudioDevices() {
  console.log('[Sokuji] [macOS Audio] Virtual audio device cleanup...');
  console.log('[Sokuji] [macOS Audio] Note: Sokuji Virtual Audio devices are system-level and persist after application exit');
  // Sokuji Virtual Audio doesn't require cleanup - it's a system driver
}

/**
 * Check if macOS audio system is available (Core Audio)
 * @returns {Promise<boolean>} True if Core Audio is available, false otherwise
 */
async function isMacOSAudioAvailable() {
  try {
    console.log('[Sokuji] [macOS Audio] Checking Core Audio availability...');

    // Check if we can list audio devices using system_profiler
    const { stdout } = await execPromise('system_profiler SPAudioDataType 2>/dev/null');

    // Core Audio is available if we can get audio device information
    const isAvailable = stdout.includes('Audio:') || stdout.includes('Devices:');
    console.log('[Sokuji] [macOS Audio] Core Audio available:', isAvailable);

    return isAvailable;
  } catch (error) {
    console.error('[Sokuji] [macOS Audio] Error checking Core Audio availability:', error);
    return false;
  }
}

/**
 * Clean up any orphaned virtual audio connections
 * Note: Sokuji Virtual Audio manages its own state, minimal cleanup needed
 * @returns {Promise<boolean>} Always returns true
 */
async function cleanupOrphanedDevices() {
  console.log('[Sokuji] [macOS Audio] Orphaned device check...');
  console.log('[Sokuji] [macOS Audio] Sokuji Virtual Audio manages its own state automatically');

  // Check if there are any stuck audio processes we should clean
  try {
    // Kill any orphaned coreaudiod processes if needed (rare)
    const { stdout } = await execPromise('ps aux | grep -i "sokuji.*audio" | grep -v grep');
    if (stdout) {
      console.log('[Sokuji] [macOS Audio] Found Sokuji Virtual Audio-related processes:', stdout.trim());
    }
  } catch (error) {
    // No processes found, which is fine
  }

  return true;
}

/**
 * Check if Sokuji Virtual Audio is installed
 * @returns {Promise<boolean>} True if Sokuji Virtual Audio is installed and functional, false otherwise
 */
async function isSokujiVirtualAudioInstalled() {
  try {
    console.log('[Sokuji] [macOS Audio] Checking Sokuji Virtual Audio installation...');

    // Method 1: Check if driver file exists
    try {
      await fs.access('/Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver');
      console.log('[Sokuji] [macOS Audio] Sokuji Virtual Audio driver found in HAL Plug-Ins');

      // Check if installation flag exists
      try {
        await fs.access('/Library/Audio/Plug-Ins/HAL/.sokuji_installed');
        console.log('[Sokuji] [macOS Audio] Installation flag confirmed');
      } catch (flagError) {
        console.log('[Sokuji] [macOS Audio] Installation flag missing, but driver exists');
      }

      return true;
    } catch (fsError) {
      // Driver file not found, continue checking other methods
    }

    // Method 2: Check using system_profiler
    try {
      const { stdout } = await execPromise('system_profiler SPAudioDataType 2>/dev/null');

      if (stdout.includes('Sokuji Virtual Audio') || stdout.includes('SokujiVirtualAudio')) {
        console.log('[Sokuji] [macOS Audio] Sokuji Virtual Audio device found in system');
        return true;
      }
    } catch (spError) {
      console.log('[Sokuji] [macOS Audio] system_profiler query failed:', spError.message);
    }

    // Method 3: Check using osascript
    try {
      const osascriptCommand = `osascript -e 'set devices to do shell script "system_profiler SPAudioDataType"' -e 'return devices contains "Sokuji"'`;
      const { stdout } = await execPromise(osascriptCommand);

      if (stdout.trim() === 'true') {
        console.log('[Sokuji] [macOS Audio] Sokuji Virtual Audio found via osascript');
        return true;
      }
    } catch (osascriptError) {
      console.log('[Sokuji] [macOS Audio] osascript query failed:', osascriptError.message);
    }

    console.log('[Sokuji] [macOS Audio] Sokuji Virtual Audio not detected by any method');
    return false;
  } catch (error) {
    console.error('[Sokuji] [macOS Audio] Error checking Sokuji Virtual Audio installation:', error);
    return false;
  }
}


/**
 * Get audio devices on macOS
 * @returns {Promise<{inputs: Array, outputs: Array}>} Audio device lists
 */
async function getAudioDevices() {
  try {
    console.log('[Sokuji] [macOS Audio] Enumerating audio devices...');

    const inputs = [];
    const outputs = [];

    // Get audio device information using system_profiler
    try {
      const { stdout } = await execPromise('system_profiler SPAudioDataType -json 2>/dev/null');
      const audioData = JSON.parse(stdout);

      // Parse the audio data structure
      if (audioData.SPAudioDataType && audioData.SPAudioDataType.length > 0) {
        const audioInfo = audioData.SPAudioDataType[0];

        // Extract input devices
        if (audioInfo._items) {
          audioInfo._items.forEach(device => {
            if (device.coreaudio_input_source) {
              inputs.push({
                name: device._name,
                manufacturer: device.coreaudio_device_manufacturer,
                id: device.coreaudio_device_id
              });
            }
            if (device.coreaudio_output_source) {
              outputs.push({
                name: device._name,
                manufacturer: device.coreaudio_device_manufacturer,
                id: device.coreaudio_device_id
              });
            }
          });
        }
      }
    } catch (jsonError) {
      // Fallback to text parsing if JSON fails
      const { stdout } = await execPromise('system_profiler SPAudioDataType 2>/dev/null');

      // Basic parsing - look for device names
      const lines = stdout.split('\n');
      let currentDevice = null;

      lines.forEach(line => {
        if (line.includes(':') && !line.includes('    ')) {
          // This might be a device name
          const deviceName = line.split(':')[0].trim();
          if (deviceName && !deviceName.includes('Audio')) {
            currentDevice = deviceName;
          }
        }
        if (currentDevice && line.includes('Input Source:')) {
          inputs.push({ name: currentDevice });
        }
        if (currentDevice && line.includes('Output Source:')) {
          outputs.push({ name: currentDevice });
        }
      });
    }

    console.log(`[Sokuji] [macOS Audio] Found ${inputs.length} input devices and ${outputs.length} output devices`);

    return {
      inputs,
      outputs
    };
  } catch (error) {
    console.error('[Sokuji] [macOS Audio] Error enumerating audio devices:', error);
    return {
      inputs: [],
      outputs: [],
      error: error.message
    };
  }
}

module.exports = {
  createVirtualAudioDevices,
  removeVirtualAudioDevices,
  isMacOSAudioAvailable,
  cleanupOrphanedDevices,
  isSokujiVirtualAudioInstalled,
  getAudioDevices
};