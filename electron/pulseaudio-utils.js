const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { execSync } = require('child_process');

// Module state - Virtual audio devices
let virtualSinkModule = null;
let virtualSourceModule = null;

// Module state - System audio capture
let systemAudioNullSinkModule = null;  // Placeholder null-sink
let systemAudioSourceModule = null;     // remap-source visible to browser
let currentSystemAudioSink = null;      // Currently connected sink name

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Execute a command with logging
 * @param {string} cmd - Command to execute
 * @param {string} description - Optional description for logging
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
async function execWithLog(cmd, description = '') {
  console.log(`[Sokuji] [PulseAudio] ${description || 'Executing:'} ${cmd}`);
  return execPromise(cmd);
}

/**
 * Load a PulseAudio module and return the module ID
 * @param {string} cmd - The pactl load-module command
 * @param {string} name - Human-readable name for logging
 * @returns {Promise<string|null>} Module ID on success, null on failure
 */
async function loadPulseModule(cmd, name) {
  const result = await execWithLog(cmd, `Creating ${name}:`);
  if (!result?.stdout) {
    console.error(`[Sokuji] [PulseAudio] Failed to create ${name}`);
    return null;
  }
  const moduleId = result.stdout.trim();
  console.log(`[Sokuji] [PulseAudio] ${name} created (ID: ${moduleId})`);
  return moduleId;
}

/**
 * Safely unload a PulseAudio module (synchronous version for cleanup)
 * @param {string|null} moduleId - Module ID to unload
 * @param {string} name - Module name for logging
 * @returns {null} Always returns null for easy assignment
 */
function unloadModuleSync(moduleId, name = 'module') {
  if (!moduleId) return null;
  try {
    execSync(`pactl unload-module ${moduleId}`);
    console.log(`[Sokuji] [PulseAudio] ${name} removed (ID: ${moduleId})`);
  } catch (e) {
    console.warn(`[Sokuji] [PulseAudio] Failed to unload ${name}:`, e.message);
  }
  return null;
}

/**
 * Cleanup modules by name patterns
 * @param {string[]} patterns - Array of patterns to match in module names
 */
function cleanupModulesByName(patterns) {
  try {
    const modules = execSync('pactl list modules short').toString();
    for (const line of modules.split('\n')) {
      for (const pattern of patterns) {
        if (line.includes(pattern)) {
          const moduleId = line.split('\t')[0];
          if (moduleId) {
            execSync(`pactl unload-module ${moduleId}`);
            console.log(`[Sokuji] [PulseAudio] Cleaned up: ${pattern} (ID: ${moduleId})`);
          }
          break;
        }
      }
    }
  } catch (e) {
    // Ignore cleanup errors
  }
}

/**
 * Disconnect physical ports from a target mic (to prevent auto-connections)
 * @param {string} targetMicName - Name of the target microphone
 */
async function disconnectPhysicalPorts(targetMicName) {
  try {
    console.log(`[Sokuji] [PulseAudio] Disconnecting physical ports from ${targetMicName}...`);
    const { stdout } = await execPromise('pw-link -o | grep -v sokuji');
    const ports = stdout.trim().split('\n').filter(Boolean);

    for (const port of ports) {
      for (const input of ['input_FL', 'input_FR', 'capture_FL', 'capture_FR']) {
        try {
          await execPromise(`pw-link -d "${port}" "input.${targetMicName}:${input}"`);
        } catch (e) {
          // Connection doesn't exist, ignore
        }
      }
    }
    console.log(`[Sokuji] [PulseAudio] Finished disconnecting physical ports`);
  } catch (e) {
    console.log(`[Sokuji] [PulseAudio] Error disconnecting physical ports:`, e.message);
  }
}

/**
 * Connect output ports to input ports using pw-link
 * @param {string} outputPattern - Pattern to match output ports
 * @param {string} inputPattern - Pattern to match input ports
 * @returns {Promise<boolean>} - True if any connections were made
 */
async function connectPorts(outputPattern, inputPattern) {
  try {
    const { stdout: outs } = await execPromise(`pw-link -o | grep "${outputPattern}"`);
    const { stdout: ins } = await execPromise(`pw-link -i | grep "${inputPattern}"`);

    const outPorts = outs.trim().split('\n').filter(Boolean);
    const inPorts = ins.trim().split('\n').filter(Boolean);

    console.log(`[Sokuji] [PulseAudio] Found output ports:`, outPorts);
    console.log(`[Sokuji] [PulseAudio] Found input ports:`, inPorts);

    if (outPorts.length === 0 || inPorts.length === 0) {
      console.log(`[Sokuji] [PulseAudio] No matching ports found`);
      return false;
    }

    for (let i = 0; i < Math.min(outPorts.length, inPorts.length); i++) {
      try {
        await execPromise(`pw-link "${outPorts[i]}" "${inPorts[i]}"`);
        console.log(`[Sokuji] [PulseAudio] Connected: ${outPorts[i]} -> ${inPorts[i]}`);
      } catch (e) {
        console.log(`[Sokuji] [PulseAudio] Connection may already exist: ${e.message}`);
      }
    }
    return true;
  } catch (e) {
    console.log(`[Sokuji] [PulseAudio] Error connecting ports:`, e.message);
    return false;
  }
}

/**
 * Disconnect output ports from input ports using pw-link
 * @param {string} outputPattern - Pattern to match output ports
 * @param {string} inputPattern - Pattern to match input ports
 * @returns {Promise<boolean>} - True if successful
 */
async function disconnectPorts(outputPattern, inputPattern) {
  try {
    const { stdout: outs } = await execPromise(`pw-link -o | grep "${outputPattern}"`);
    const { stdout: ins } = await execPromise(`pw-link -i | grep "${inputPattern}"`);

    const outPorts = outs.trim().split('\n').filter(Boolean);
    const inPorts = ins.trim().split('\n').filter(Boolean);

    for (let i = 0; i < Math.min(outPorts.length, inPorts.length); i++) {
      try {
        await execPromise(`pw-link -d "${outPorts[i]}" "${inPorts[i]}"`);
        console.log(`[Sokuji] [PulseAudio] Disconnected: ${outPorts[i]} from ${inPorts[i]}`);
      } catch (e) {
        // Connection doesn't exist, ignore
      }
    }
    return true;
  } catch (e) {
    console.log(`[Sokuji] [PulseAudio] Error disconnecting ports:`, e.message);
    return false;
  }
}

/**
 * Verify connections using pw-link or pactl
 * @param {string} pattern - Pattern to grep for
 */
async function verifyConnections(pattern) {
  try {
    const { stdout } = await execPromise(`pw-link -l | grep -i ${pattern}`);
    console.log(`[Sokuji] [PulseAudio] Current connections:`, stdout.trim());
  } catch (e) {
    try {
      const { stdout } = await execPromise(`pactl list short | grep ${pattern}`);
      console.log(`[Sokuji] [PulseAudio] Current devices:`, stdout.trim());
    } catch (e2) {
      console.log(`[Sokuji] [PulseAudio] Could not verify connections`);
    }
  }
}

// ============================================================================
// Virtual Audio Devices (for TTS output + System Audio Capture)
// ============================================================================

/**
 * Create all virtual audio devices (speaker + mic for TTS, and system audio mic)
 * @returns {Promise<boolean>} True if successful
 */
async function createVirtualAudioDevices() {
  try {
    // ========== Virtual Speaker + Mic (for TTS output) ==========
    virtualSinkModule = await loadPulseModule(
      'pactl load-module module-null-sink sink_name=sokuji_virtual_output sink_properties=device.description="Sokuji_Virtual_Speaker"',
      'virtual sink'
    );
    if (!virtualSinkModule) return false;

    virtualSourceModule = await loadPulseModule(
      'pactl load-module module-remap-source master=sokuji_virtual_output.monitor source_name=sokuji_virtual_mic source_properties=device.description="Sokuji_Virtual_Mic" channel_map=front-left,front-right',
      'virtual mic'
    );
    if (!virtualSourceModule) {
      virtualSinkModule = unloadModuleSync(virtualSinkModule, 'virtual sink');
      return false;
    }

    // ========== System Audio Capture Mic ==========
    systemAudioNullSinkModule = await loadPulseModule(
      'pactl load-module module-null-sink sink_name=sokuji_system_audio_null sink_properties=device.description="Sokuji_System_Audio_Internal"',
      'system audio null sink'
    );
    if (systemAudioNullSinkModule) {
      systemAudioSourceModule = await loadPulseModule(
        'pactl load-module module-remap-source master=sokuji_system_audio_null.monitor source_name=sokuji_system_audio_mic source_properties=device.description="Sokuji_System_Audio"',
        'system audio mic'
      );
    }

    // Wait for connections to stabilize
    await new Promise(resolve => setTimeout(resolve, 100));

    // Disconnect automatic connections from physical mics
    await disconnectPhysicalPorts('sokuji_virtual_mic');
    await disconnectPhysicalPorts('sokuji_system_audio_mic');

    // Connect virtual speaker to virtual mic
    await connectPorts('sokuji_virtual_output', 'sokuji_virtual_mic');

    // Verify
    await verifyConnections('sokuji');

    console.log('[Sokuji] [PulseAudio] All virtual audio devices created successfully');
    return true;
  } catch (error) {
    console.error('[Sokuji] [PulseAudio] Failed to create virtual audio devices:', error);
    // Cleanup on failure
    systemAudioSourceModule = unloadModuleSync(systemAudioSourceModule, 'system audio mic');
    systemAudioNullSinkModule = unloadModuleSync(systemAudioNullSinkModule, 'system audio null sink');
    virtualSourceModule = unloadModuleSync(virtualSourceModule, 'virtual mic');
    virtualSinkModule = unloadModuleSync(virtualSinkModule, 'virtual sink');
    return false;
  }
}

/**
 * Remove all virtual audio devices
 */
function removeVirtualAudioDevices() {
  console.log('[Sokuji] [PulseAudio] Removing all virtual audio devices...');

  // Remove system audio devices
  systemAudioSourceModule = unloadModuleSync(systemAudioSourceModule, 'system audio mic');
  systemAudioNullSinkModule = unloadModuleSync(systemAudioNullSinkModule, 'system audio null sink');
  currentSystemAudioSink = null;

  // Remove virtual TTS devices
  virtualSourceModule = unloadModuleSync(virtualSourceModule, 'virtual mic');
  virtualSinkModule = unloadModuleSync(virtualSinkModule, 'virtual sink');

  // Fallback cleanup by name
  cleanupModulesByName([
    'sokuji_virtual_output',
    'sokuji_virtual_mic',
    'sokuji_virtual_speaker',
    'sokuji_system_audio_null',
    'sokuji_system_audio_mic'
  ]);

  console.log('[Sokuji] [PulseAudio] All virtual audio device cleanup completed');
}

// ============================================================================
// System Audio Capture (for capturing meeting participants)
// ============================================================================

/**
 * List available audio sinks (outputs) that can be captured
 * @returns {Promise<Array<{deviceId: string, label: string}>>}
 */
async function listSystemAudioSources() {
  try {
    const { stdout } = await execWithLog('pactl list sinks', 'Listing sinks:');
    const sources = [];
    const sinkBlocks = stdout.split('Sink #');

    for (const block of sinkBlocks) {
      if (!block.trim()) continue;

      const nameMatch = block.match(/Name: (.+)/);
      const descMatch = block.match(/Description: (.+)/);

      if (nameMatch) {
        const name = nameMatch[1].trim();
        if (name.includes('sokuji_')) continue; // Skip our virtual sinks

        sources.push({
          deviceId: name,
          label: descMatch ? descMatch[1].trim() : name
        });
      }
    }

    console.log(`[Sokuji] [PulseAudio] Found ${sources.length} system audio sources`);
    return sources;
  } catch (error) {
    console.error('[Sokuji] [PulseAudio] Error listing system audio sources:', error);
    return [];
  }
}

/**
 * Connect a sink's monitor to the system audio mic
 * Only changes pw-link connections, does not recreate modules
 * @param {string} sinkName - The sink name to capture from
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function connectSystemAudioSource(sinkName) {
  try {
    console.log(`[Sokuji] [PulseAudio] Connecting system audio to: ${sinkName}`);

    // Disconnect from previous sink if any
    if (currentSystemAudioSink) {
      console.log(`[Sokuji] [PulseAudio] Disconnecting from previous source: ${currentSystemAudioSink}`);
      await disconnectPorts(currentSystemAudioSink, 'sokuji_system_audio_mic');
    }

    // Also disconnect from the placeholder null-sink monitor
    await disconnectPorts('sokuji_system_audio_null', 'sokuji_system_audio_mic');

    // Connect the new sink's monitor to system audio mic
    const connected = await connectPorts(sinkName, 'sokuji_system_audio_mic');

    if (connected) {
      currentSystemAudioSink = sinkName;
      console.log(`[Sokuji] [PulseAudio] System audio now capturing from: ${sinkName}`);
      await verifyConnections('sokuji_system_audio');
      return { success: true };
    } else {
      return { success: false, error: 'Failed to connect ports' };
    }
  } catch (error) {
    console.error('[Sokuji] [PulseAudio] Error connecting system audio source:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Disconnect the current system audio source
 * @returns {Promise<{success: boolean}>}
 */
async function disconnectSystemAudioSource() {
  try {
    console.log('[Sokuji] [PulseAudio] Disconnecting system audio source...');

    if (currentSystemAudioSink) {
      await disconnectPorts(currentSystemAudioSink, 'sokuji_system_audio_mic');
      currentSystemAudioSink = null;
      console.log('[Sokuji] [PulseAudio] System audio disconnected');
    } else {
      console.log('[Sokuji] [PulseAudio] No system audio source was connected');
    }

    return { success: true };
  } catch (error) {
    console.error('[Sokuji] [PulseAudio] Error disconnecting system audio source:', error);
    return { success: false };
  }
}

/**
 * Check if system audio capture is supported
 * @returns {Promise<boolean>}
 */
async function supportsSystemAudioCapture() {
  try {
    const isAvailable = await isPulseAudioAvailable();
    return isAvailable && process.platform === 'linux';
  } catch (error) {
    return false;
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Check if PulseAudio is available
 * @returns {Promise<boolean>}
 */
async function isPulseAudioAvailable() {
  try {
    const { stdout } = await execWithLog('pactl info', 'Checking availability:');
    const isAvailable = stdout.includes('PulseAudio') || stdout.includes('Server Name');
    console.log(`[Sokuji] [PulseAudio] Available: ${isAvailable}`);
    return isAvailable;
  } catch (error) {
    console.error('[Sokuji] [PulseAudio] Error checking availability:', error);
    return false;
  }
}

/**
 * Check for and clean up any orphaned virtual audio devices
 * @returns {Promise<boolean>}
 */
async function cleanupOrphanedDevices() {
  console.log('[Sokuji] [PulseAudio] Checking for orphaned devices...');

  try {
    // Check sinks
    const { stdout: sinkList } = await execWithLog('pactl list sinks short', 'Checking sinks:');
    const orphanedSinks = [
      'sokuji_virtual_output',
      'sokuji_virtual_speaker',
      'sokuji_system_audio_null'
    ];
    for (const sink of orphanedSinks) {
      if (sinkList.includes(sink)) {
        console.log(`[Sokuji] [PulseAudio] Found orphaned sink: ${sink}`);
        cleanupModulesByName([sink]);
      }
    }

    // Check sources
    const { stdout: sourceList } = await execWithLog('pactl list sources short', 'Checking sources:');
    const orphanedSources = ['sokuji_virtual_mic', 'sokuji_system_audio_mic'];
    for (const source of orphanedSources) {
      if (sourceList.includes(source)) {
        console.log(`[Sokuji] [PulseAudio] Found orphaned source: ${source}`);
        cleanupModulesByName([source]);
      }
    }

    console.log('[Sokuji] [PulseAudio] Orphaned device check completed');
    return true;
  } catch (error) {
    console.error('[Sokuji] [PulseAudio] Error checking for orphaned devices:', error);
    return false;
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Virtual audio devices (includes both TTS and System Audio devices)
  createVirtualAudioDevices,
  removeVirtualAudioDevices,
  // System audio capture
  listSystemAudioSources,
  connectSystemAudioSource,
  disconnectSystemAudioSource,
  supportsSystemAudioCapture,
  // Utilities
  isPulseAudioAvailable,
  cleanupOrphanedDevices
};
