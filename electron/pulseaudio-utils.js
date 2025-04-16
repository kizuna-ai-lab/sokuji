const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { execSync } = require('child_process');

let virtualSinkModule = null;
let virtualSourceModule = null;

/**
 * Start PulseAudio virtual devices to create a virtual microphone
 * @returns {Promise<boolean>} True if virtual devices were created successfully, false otherwise
 */
async function createVirtualAudioDevices() {
  try {
    // Create a virtual output sink
    const sinkResult = await execPromise('pactl load-module module-null-sink sink_name=sokuji_virtual_output sink_properties=device.description="Sokuji_Virtual_Speaker"');
    if (sinkResult && sinkResult.stdout) {
      virtualSinkModule = sinkResult.stdout.trim();
      console.log(`Created virtual sink with module ID: ${virtualSinkModule}`);
    } else {
      console.error('Failed to create virtual sink');
      return false;
    }

    // Create a virtual microphone source that uses the virtual sink as its monitor
    const sourceResult = await execPromise('pactl load-module module-remap-source master=sokuji_virtual_output.monitor source_name=sokuji_virtual_mic source_properties=device.description="Sokuji_Virtual_Mic"');
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
    console.log('Starting virtual audio device cleanup...');
    
    // Unload the source module first
    if (virtualSourceModule) {
      try {
        console.log(`Removing virtual source module ID: ${virtualSourceModule}`);
        // Use execSync for more reliable cleanup during exit
        execSync(`pactl unload-module ${virtualSourceModule}`);
        console.log('Virtual microphone source stopped');
        virtualSourceModule = null;
      } catch (sourceError) {
        console.error(`Failed to unload source module: ${sourceError}`);
      }
    } else {
      console.log('No virtual source module to remove');
    }

    // Then unload the sink module
    if (virtualSinkModule) {
      try {
        console.log(`Removing virtual sink module ID: ${virtualSinkModule}`);
        // Use execSync for more reliable cleanup during exit
        execSync(`pactl unload-module ${virtualSinkModule}`);
        console.log('Virtual sink stopped');
        virtualSinkModule = null;
      } catch (sinkError) {
        console.error(`Failed to unload sink module: ${sinkError}`);
      }
    } else {
      console.log('No virtual sink module to remove');
    }
    
    // Additional fallback cleanup - try to find and remove by name if module IDs are not available
    try {
      const sinkList = execSync('pactl list sinks short').toString();
      if (sinkList.includes('sokuji_virtual_output')) {
        console.log('Found sokuji_virtual_output sink, attempting cleanup by name...');
        const moduleInfo = execSync('pactl list modules short | grep sokuji_virtual_output').toString();
        const moduleId = moduleInfo.split('\t')[0];
        if (moduleId) {
          execSync(`pactl unload-module ${moduleId}`);
          console.log(`Cleaned up sink module by name: ${moduleId}`);
        }
      }
      
      const sourceList = execSync('pactl list sources short').toString();
      if (sourceList.includes('sokuji_virtual_mic')) {
        console.log('Found sokuji_virtual_mic source, attempting cleanup by name...');
        const moduleInfo = execSync('pactl list modules short | grep sokuji_virtual_mic').toString();
        const moduleId = moduleInfo.split('\t')[0];
        if (moduleId) {
          execSync(`pactl unload-module ${moduleId}`);
          console.log(`Cleaned up source module by name: ${moduleId}`);
        }
      }
    } catch (fallbackError) {
      // Ignore fallback errors - this is just an extra precaution
    }
    
    console.log('Virtual audio device cleanup completed');
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
    const { stdout } = await execPromise('pactl info');
    return stdout.includes('PulseAudio') || stdout.includes('Server Name');
  } catch (error) {
    console.error('Error checking PulseAudio availability:', error);
    return false;
  }
}

/**
 * Check for and clean up any orphaned virtual audio devices
 * This is useful when the application crashes or is forcibly terminated
 */
async function cleanupOrphanedDevices() {
  try {
    console.log('Checking for orphaned virtual audio devices...');
    
    // Check for sokuji_virtual_output sink
    const { stdout: sinkList } = await execPromise('pactl list sinks short');
    if (sinkList.includes('sokuji_virtual_output')) {
      console.log('Found orphaned virtual sink, cleaning up...');
      try {
        const { stdout: moduleInfo } = await execPromise('pactl list modules short | grep sokuji_virtual_output');
        const moduleId = moduleInfo.split('\t')[0];
        if (moduleId) {
          execSync(`pactl unload-module ${moduleId}`);
          console.log(`Cleaned up orphaned sink module: ${moduleId}`);
        }
      } catch (error) {
        console.error('Error cleaning up orphaned sink:', error);
      }
    }
    
    // Check for sokuji_virtual_mic source
    const { stdout: sourceList } = await execPromise('pactl list sources short');
    if (sourceList.includes('sokuji_virtual_mic')) {
      console.log('Found orphaned virtual source, cleaning up...');
      try {
        const { stdout: moduleInfo } = await execPromise('pactl list modules short | grep sokuji_virtual_mic');
        const moduleId = moduleInfo.split('\t')[0];
        if (moduleId) {
          execSync(`pactl unload-module ${moduleId}`);
          console.log(`Cleaned up orphaned source module: ${moduleId}`);
        }
      } catch (error) {
        console.error('Error cleaning up orphaned source:', error);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error checking for orphaned devices:', error);
    return false;
  }
}

module.exports = {
  createVirtualAudioDevices,
  removeVirtualAudioDevices,
  isPulseAudioAvailable,
  cleanupOrphanedDevices
};
