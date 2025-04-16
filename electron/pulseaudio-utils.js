const { spawn, exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

let virtualSinkModule = null;
let virtualSourceModule = null;

/**
 * Start PulseAudio virtual devices to create a virtual microphone
 * @returns {Promise<boolean>} True if virtual devices were created successfully, false otherwise
 */
async function createVirtualAudioDevices() {
  try {
    // Create a virtual output sink
    const sinkResult = await execPromise('pactl load-module module-null-sink sink_name=virtual_output sink_properties=device.description="Virtual_Mic_Speaker"');
    if (sinkResult && sinkResult.stdout) {
      virtualSinkModule = sinkResult.stdout.trim();
      console.log(`Created virtual sink with module ID: ${virtualSinkModule}`);
    } else {
      console.error('Failed to create virtual sink');
      return false;
    }

    // Create a virtual microphone source that uses the virtual sink as its monitor
    const sourceResult = await execPromise('pactl load-module module-remap-source master=virtual_output.monitor source_name=virtual_mic_source source_properties=device.description="Virtual_Mic"');
    if (sourceResult && sourceResult.stdout) {
      virtualSourceModule = sourceResult.stdout.trim();
      console.log(`Created virtual microphone with module ID: ${virtualSourceModule}`);
    } else {
      console.error('Failed to create virtual microphone source');
      // Clean up the sink if source creation fails
      if (virtualSinkModule) {
        await execPromise(`pactl unload-module ${virtualSinkModule}`);
        virtualSinkModule = null;
      }
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to create virtual audio devices:', error);
    // Clean up any modules that might have been created
    try {
      if (virtualSinkModule) {
        await execPromise(`pactl unload-module ${virtualSinkModule}`);
        virtualSinkModule = null;
      }
      if (virtualSourceModule) {
        await execPromise(`pactl unload-module ${virtualSourceModule}`);
        virtualSourceModule = null;
      }
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
    }
    return false;
  }
}

/**
 * Stop the virtual audio devices
 */
function removeVirtualAudioDevices() {
  try {
    // Unload the source module first
    if (virtualSourceModule) {
      exec(`pactl unload-module ${virtualSourceModule}`, (error) => {
        if (error) {
          console.error(`Failed to unload source module: ${error}`);
        } else {
          console.log('Virtual microphone source stopped');
          virtualSourceModule = null;
        }
      });
    }

    // Then unload the sink module
    if (virtualSinkModule) {
      exec(`pactl unload-module ${virtualSinkModule}`, (error) => {
        if (error) {
          console.error(`Failed to unload sink module: ${error}`);
        } else {
          console.log('Virtual sink stopped');
          virtualSinkModule = null;
        }
      });
    }
  } catch (error) {
    console.error('Error stopping virtual audio devices:', error);
  }
}

/**
 * Check if PulseAudio is available
 * @returns {Promise<boolean>} True if PulseAudio is available, false otherwise
 */
async function isPulseAudioAvailable() {
  try {
    const { stdout, stderr } = await execPromise('pactl info');
    return stdout.includes('PulseAudio') || stdout.includes('Server Name');
  } catch (error) {
    console.error('Error checking PulseAudio availability:', error);
    return false;
  }
}

module.exports = {
  isPulseAudioAvailable,
  createVirtualAudioDevices,
  removeVirtualAudioDevices
};
