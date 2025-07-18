const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { execSync } = require('child_process');

let virtualSinkModule = null;
let virtualSourceModule = null;

/**
 * Connect virtual speaker monitor to virtual mic using pw-link
 * @returns {Promise<boolean>} - True if connection successful, false otherwise
 */
async function connectVirtualDevices() {
  try {
    console.log('[Sokuji] [PulseAudio] Connecting virtual speaker monitor to virtual mic...');
    
    // Try to connect using pw-link
    try {
      // First, let's find the exact port names
      const { stdout: outputPorts } = await execPromise('pw-link -o | grep sokuji_virtual_output');
      const { stdout: inputPorts } = await execPromise('pw-link -i | grep sokuji_virtual_mic');
      
      console.log('[Sokuji] [PulseAudio] Found output ports:', outputPorts.trim());
      console.log('[Sokuji] [PulseAudio] Found input ports:', inputPorts.trim());
      
      // Parse the ports
      const outputPortsArray = outputPorts.trim().split('\n').filter(Boolean);
      const inputPortsArray = inputPorts.trim().split('\n').filter(Boolean);
      
      if (outputPortsArray.length === 0 || inputPortsArray.length === 0) {
        throw new Error('No matching ports found');
      }
      
      // Connect each channel
      for (let i = 0; i < Math.min(outputPortsArray.length, inputPortsArray.length); i++) {
        await execPromise(`pw-link "${outputPortsArray[i]}" "${inputPortsArray[i]}"`);
        console.log(`[Sokuji] [PulseAudio] Connected: ${outputPortsArray[i]} -> ${inputPortsArray[i]}`);
      }
      
      console.log('[Sokuji] [PulseAudio] Successfully connected virtual devices using pw-link');
      return true;
    } catch (pwError) {
      // If pw-link fails, try using pactl
      console.log('[Sokuji] [PulseAudio] pw-link failed, trying pactl method...');
      
      // The module-remap-source should handle this automatically, but we can verify
      const { stdout } = await execPromise('pactl list sources short | grep sokuji_virtual_mic');
      if (stdout.includes('sokuji_virtual_mic')) {
        console.log('[Sokuji] [PulseAudio] Virtual mic is using monitor source (auto-connected via module-remap-source)');
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('[Sokuji] [PulseAudio] Failed to connect virtual devices:', error);
    return false;
  }
}

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
      console.log(`[Sokuji] [PulseAudio] Created virtual sink with module ID: ${virtualSinkModule}`);
    } else {
      console.error('[Sokuji] [PulseAudio] Failed to create virtual sink');
      return false;
    }

    // Create a virtual microphone source that uses the virtual sink as its monitor
    const sourceResult = await execPromise('pactl load-module module-remap-source master=sokuji_virtual_output.monitor source_name=sokuji_virtual_mic source_properties=device.description="Sokuji_Virtual_Mic"');
    if (sourceResult && sourceResult.stdout) {
      virtualSourceModule = sourceResult.stdout.trim();
      console.log(`[Sokuji] [PulseAudio] Created virtual microphone with module ID: ${virtualSourceModule}`);
    } else {
      console.error('[Sokuji] [PulseAudio] Failed to create virtual microphone source');
      // Clean up the sink if source creation fails
      if (virtualSinkModule) {
        await execPromise(`pactl unload-module ${virtualSinkModule}`);
        virtualSinkModule = null;
      }
      return false;
    }

    // Connect the virtual devices
    const connected = await connectVirtualDevices();
    if (!connected) {
      console.log('[Sokuji] [PulseAudio] Warning: Virtual devices created but connection might not be established');
    }
    
    console.log('[Sokuji] [PulseAudio] Virtual audio devices created successfully');
    return true;
  } catch (error) {
    console.error('[Sokuji] [PulseAudio] Failed to create virtual audio devices:', error);
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
      console.error('[Sokuji] [PulseAudio] Error during cleanup:', cleanupError);
    }
    return false;
  }
}

/**
 * Stop the virtual audio devices
 */
function removeVirtualAudioDevices() {
  try {
    console.log('[Sokuji] [PulseAudio] Starting virtual audio device cleanup...');
    
    // Unload the source module first
    if (virtualSourceModule) {
      try {
        console.log(`[Sokuji] [PulseAudio] Removing virtual source module ID: ${virtualSourceModule}`);
        // Use execSync for more reliable cleanup during exit
        execSync(`pactl unload-module ${virtualSourceModule}`);
        console.log('[Sokuji] [PulseAudio] Virtual microphone source stopped');
        virtualSourceModule = null;
      } catch (sourceError) {
        console.error(`[Sokuji] [PulseAudio] Failed to unload source module: ${sourceError}`);
      }
    } else {
      console.log('[Sokuji] [PulseAudio] No virtual source module to remove');
    }

    // Then unload the sink module
    if (virtualSinkModule) {
      try {
        console.log(`[Sokuji] [PulseAudio] Removing virtual sink module ID: ${virtualSinkModule}`);
        // Use execSync for more reliable cleanup during exit
        execSync(`pactl unload-module ${virtualSinkModule}`);
        console.log('[Sokuji] [PulseAudio] Virtual sink stopped');
        virtualSinkModule = null;
      } catch (sinkError) {
        console.error(`[Sokuji] [PulseAudio] Failed to unload sink module: ${sinkError}`);
      }
    } else {
      console.log('[Sokuji] [PulseAudio] No virtual sink module to remove');
    }
    
    // Additional fallback cleanup - try to find and remove by name if module IDs are not available
    try {
      const sinkList = execSync('pactl list sinks short').toString();
      if (sinkList.includes('sokuji_virtual_output')) {
        console.log('[Sokuji] [PulseAudio] Found sokuji_virtual_output sink, attempting cleanup by name...');
        const moduleInfo = execSync('pactl list modules short | grep sokuji_virtual_output').toString();
        const moduleId = moduleInfo.split('\t')[0];
        if (moduleId) {
          execSync(`pactl unload-module ${moduleId}`);
          console.log(`[Sokuji] [PulseAudio] Cleaned up sink module by name: ${moduleId}`);
        }
      }
      
      const sourceList = execSync('pactl list sources short').toString();
      if (sourceList.includes('sokuji_virtual_mic')) {
        console.log('[Sokuji] [PulseAudio] Found sokuji_virtual_mic source, attempting cleanup by name...');
        const moduleInfo = execSync('pactl list modules short | grep sokuji_virtual_mic').toString();
        const moduleId = moduleInfo.split('\t')[0];
        if (moduleId) {
          execSync(`pactl unload-module ${moduleId}`);
          console.log(`[Sokuji] [PulseAudio] Cleaned up source module by name: ${moduleId}`);
        }
      }
    } catch (fallbackError) {
      // Ignore fallback errors - this is just an extra precaution
    }
    
    console.log('[Sokuji] [PulseAudio] Virtual audio device cleanup completed');
  } catch (error) {
    console.error('[Sokuji] [PulseAudio] Error stopping virtual audio devices:', error);
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
    console.error('[Sokuji] [PulseAudio] Error checking PulseAudio availability:', error);
    return false;
  }
}

/**
 * Check for and clean up any orphaned virtual audio devices
 * This is useful when the application crashes or is forcibly terminated
 */
async function cleanupOrphanedDevices() {
  try {
    console.log('[Sokuji] [PulseAudio] Checking for orphaned virtual audio devices...');
    
    // Check for sokuji_virtual_output sink
    const { stdout: sinkList } = await execPromise('pactl list sinks short');
    if (sinkList.includes('sokuji_virtual_output')) {
      console.log('[Sokuji] [PulseAudio] Found orphaned virtual sink, cleaning up...');
      try {
        const { stdout: moduleInfo } = await execPromise('pactl list modules short | grep sokuji_virtual_output');
        const moduleId = moduleInfo.split('\t')[0];
        if (moduleId) {
          execSync(`pactl unload-module ${moduleId}`);
          console.log(`[Sokuji] [PulseAudio] Cleaned up orphaned sink module: ${moduleId}`);
        }
      } catch (error) {
        console.error('[Sokuji] [PulseAudio] Error cleaning up orphaned sink:', error);
      }
    }
    
    // Check for sokuji_virtual_mic source
    const { stdout: sourceList } = await execPromise('pactl list sources short');
    if (sourceList.includes('sokuji_virtual_mic')) {
      console.log('[Sokuji] [PulseAudio] Found orphaned virtual source, cleaning up...');
      try {
        const { stdout: moduleInfo } = await execPromise('pactl list modules short | grep sokuji_virtual_mic');
        const moduleId = moduleInfo.split('\t')[0];
        if (moduleId) {
          execSync(`pactl unload-module ${moduleId}`);
          console.log(`[Sokuji] [PulseAudio] Cleaned up orphaned source module: ${moduleId}`);
        }
      } catch (error) {
        console.error('[Sokuji] [PulseAudio] Error cleaning up orphaned source:', error);
      }
    }
    
    
    // Check for sokuji_virtual_speaker
    const { stdout: speakerList } = await execPromise('pactl list sinks short');
    if (speakerList.includes('sokuji_virtual_speaker')) {
      console.log('[Sokuji] [PulseAudio] Found orphaned virtual speaker, cleaning up...');
      try {
        const { stdout: moduleInfo } = await execPromise('pactl list modules short | grep sokuji_virtual_speaker');
        const moduleId = moduleInfo.split('\t')[0];
        if (moduleId) {
          execSync(`pactl unload-module ${moduleId}`);
          console.log(`[Sokuji] [PulseAudio] Cleaned up orphaned speaker module: ${moduleId}`);
        }
      } catch (error) {
        console.error('[Sokuji] [PulseAudio] Error cleaning up orphaned speaker:', error);
      }
    }
    
    return true;
  } catch (error) {
    console.error('[Sokuji] [PulseAudio] Error checking for orphaned devices:', error);
    return false;
  }
}



module.exports = {
  createVirtualAudioDevices,
  removeVirtualAudioDevices,
  isPulseAudioAvailable,
  cleanupOrphanedDevices
};