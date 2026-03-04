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
 * Create virtual audio devices on macOS using Eburon Virtual Audio
 * This function checks if our bundled driver is installed by the PKG installer
 * @returns {Promise<boolean>} True if virtual devices can be used, false otherwise
 */
async function createVirtualAudioDevices() {
  try {
    console.log('[Eburon] [macOS Audio] Checking for Eburon Virtual Audio devices...');

    // Check if our custom driver is installed
    const isInstalled = await isEburonVirtualAudioInstalled();

    if (isInstalled) {
      console.log('[Eburon] [macOS Audio] Eburon Virtual Audio is installed and ready');
      return true;
    }

    console.log('[Eburon] [macOS Audio] Eburon Virtual Audio not detected');
    console.log('[Eburon] [macOS Audio] Virtual audio driver not found. This may happen if:');
    console.log('[Eburon] [macOS Audio] - The application was not installed via the official PKG installer');
    console.log('[Eburon] [macOS Audio] - The PKG installer driver installation failed');
    console.log('[Eburon] [macOS Audio] - macOS security settings blocked the driver');
    console.log('[Eburon] [macOS Audio] - System requires restart to load the driver');
    console.log('[Eburon] [macOS Audio] Please reinstall Eburon using the official PKG installer');
    console.log('[Eburon] [macOS Audio] If the problem persists, try restarting your Mac');
    console.log('[Eburon] [macOS Audio] Application will continue without virtual microphone support');
    return false;
  } catch (error) {
    console.error('[Eburon] [macOS Audio] Error checking virtual audio devices:', error);
    return false;
  }
}

/**
 * Remove/disconnect virtual audio devices on macOS
 * Note: Eburon Virtual Audio devices are system-level and don't need cleanup
 */
function removeVirtualAudioDevices() {
  console.log('[Eburon] [macOS Audio] Virtual audio device cleanup...');
  console.log('[Eburon] [macOS Audio] Note: Eburon Virtual Audio devices are system-level and persist after application exit');
  // Eburon Virtual Audio doesn't require cleanup - it's a system driver
}

/**
 * Check if macOS audio system is available (Core Audio)
 * @returns {Promise<boolean>} True if Core Audio is available, false otherwise
 */
async function isMacOSAudioAvailable() {
  try {
    console.log('[Eburon] [macOS Audio] Checking Core Audio availability...');

    // Check if we can list audio devices using system_profiler
    const { stdout } = await execPromise('system_profiler SPAudioDataType 2>/dev/null');

    // Core Audio is available if we can get audio device information
    const isAvailable = stdout.includes('Audio:') || stdout.includes('Devices:');
    console.log('[Eburon] [macOS Audio] Core Audio available:', isAvailable);

    return isAvailable;
  } catch (error) {
    console.error('[Eburon] [macOS Audio] Error checking Core Audio availability:', error);
    return false;
  }
}

/**
 * Clean up any orphaned virtual audio connections
 * Note: Eburon Virtual Audio manages its own state, minimal cleanup needed
 * @returns {Promise<boolean>} Always returns true
 */
async function cleanupOrphanedDevices() {
  console.log('[Eburon] [macOS Audio] Orphaned device check...');
  console.log('[Eburon] [macOS Audio] Eburon Virtual Audio manages its own state automatically');

  // Check if there are any stuck audio processes we should clean
  try {
    // Kill any orphaned coreaudiod processes if needed (rare)
    const { stdout } = await execPromise('ps aux | grep -i "Eburon.*audio" | grep -v grep');
    if (stdout) {
      console.log('[Eburon] [macOS Audio] Found Eburon Virtual Audio-related processes:', stdout.trim());
    }
  } catch (error) {
    // No processes found, which is fine
  }

  return true;
}

/**
 * Check if Eburon Virtual Audio is installed
 * @returns {Promise<boolean>} True if Eburon Virtual Audio is installed and functional, false otherwise
 */
async function isEburonVirtualAudioInstalled() {
  try {
    console.log('[Eburon] [macOS Audio] Checking Eburon Virtual Audio installation...');

    // Method 1: Check if driver file exists
    try {
      await fs.access('/Library/Audio/Plug-Ins/HAL/EburonVirtualAudio.driver');
      console.log('[Eburon] [macOS Audio] Eburon Virtual Audio driver found in HAL Plug-Ins');

      // Check if installation flag exists
      try {
        await fs.access('/Library/Audio/Plug-Ins/HAL/.Eburon_installed');
        console.log('[Eburon] [macOS Audio] Installation flag confirmed');
      } catch (flagError) {
        console.log('[Eburon] [macOS Audio] Installation flag missing, but driver exists');
      }

      return true;
    } catch (fsError) {
      // Driver file not found, continue checking other methods
    }

    // Method 2: Check using system_profiler
    try {
      const { stdout } = await execPromise('system_profiler SPAudioDataType 2>/dev/null');

      if (stdout.includes('Eburon Virtual Audio') || stdout.includes('EburonVirtualAudio')) {
        console.log('[Eburon] [macOS Audio] Eburon Virtual Audio device found in system');
        return true;
      }
    } catch (spError) {
      console.log('[Eburon] [macOS Audio] system_profiler query failed:', spError.message);
    }

    // Method 3: Check using osascript
    try {
      const osascriptCommand = `osascript -e 'set devices to do shell script "system_profiler SPAudioDataType"' -e 'return devices contains "Eburon"'`;
      const { stdout } = await execPromise(osascriptCommand);

      if (stdout.trim() === 'true') {
        console.log('[Eburon] [macOS Audio] Eburon Virtual Audio found via osascript');
        return true;
      }
    } catch (osascriptError) {
      console.log('[Eburon] [macOS Audio] osascript query failed:', osascriptError.message);
    }

    console.log('[Eburon] [macOS Audio] Eburon Virtual Audio not detected by any method');
    return false;
  } catch (error) {
    console.error('[Eburon] [macOS Audio] Error checking Eburon Virtual Audio installation:', error);
    return false;
  }
}


/**
 * Get audio devices on macOS
 * @returns {Promise<{inputs: Array, outputs: Array}>} Audio device lists
 */
async function getAudioDevices() {
  try {
    console.log('[Eburon] [macOS Audio] Enumerating audio devices...');

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

    console.log(`[Eburon] [macOS Audio] Found ${inputs.length} input devices and ${outputs.length} output devices`);

    return {
      inputs,
      outputs
    };
  } catch (error) {
    console.error('[Eburon] [macOS Audio] Error enumerating audio devices:', error);
    return {
      inputs: [],
      outputs: [],
      error: error.message
    };
  }
}

// ============================================================================
// System Audio Capture Functions (macOS via electron-audio-loopback)
// ============================================================================

/**
 * Check if system audio capture is supported
 * On macOS, this is always true when running in Electron (uses electron-audio-loopback)
 * @returns {Promise<boolean>} True if system audio capture is supported
 */
async function supportsSystemAudioCapture() {
  console.log('[Eburon] [macOS Audio] System audio capture is supported via electron-audio-loopback');
  return true;
}

/**
 * List available system audio sources
 * On macOS, we provide a single "System Audio" source that captures all system audio
 * via the electron-audio-loopback feature (uses getDisplayMedia with loopback audio)
 * @returns {Promise<Array<{deviceId: string, label: string}>>} Array of system audio sources
 */
async function listSystemAudioSources() {
  console.log('[Eburon] [macOS Audio] Listing system audio sources');
  // macOS captures system audio via screen selection, so we return a single source
  return [{
    deviceId: 'desktop-audio-loopback',
    label: 'System Audio (Screen Selection Required)'
  }];
}

/**
 * Connect to a system audio source
 * On macOS, this is a no-op since the actual capture is done via getDisplayMedia in the renderer
 * The user will select a screen/window when starting participant audio capture
 * @param {string} sourceId - The source ID to connect to
 * @returns {Promise<{success: boolean, error?: string}>} Result object
 */
async function connectSystemAudioSource(sourceId) {
  console.log(`[Eburon] [macOS Audio] Connect system audio source: ${sourceId}`);
  // On macOS, the "connection" happens when getDisplayMedia is called in the renderer
  // This function just acknowledges the intent to capture
  return { success: true };
}

/**
 * Disconnect from the current system audio source
 * On macOS, this is a no-op since cleanup happens in the renderer
 * @returns {Promise<{success: boolean}>} Result object
 */
async function disconnectSystemAudioSource() {
  console.log('[Eburon] [macOS Audio] Disconnect system audio source');
  // Cleanup happens in the renderer when the MediaStream is stopped
  return { success: true };
}

module.exports = {
  createVirtualAudioDevices,
  removeVirtualAudioDevices,
  isMacOSAudioAvailable,
  cleanupOrphanedDevices,
  isEburonVirtualAudioInstalled,
  getAudioDevices,
  // System audio capture functions
  supportsSystemAudioCapture,
  listSystemAudioSources,
  connectSystemAudioSource,
  disconnectSystemAudioSource
};