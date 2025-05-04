const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { execSync } = require('child_process');

let virtualSinkModule = null;
let virtualSourceModule = null;

/**
 * Connect two audio ports using pw-link
 * @param {string} outputPortName - Name pattern of the output port
 * @param {string} inputPortName - Name pattern of the input port
 * @returns {Promise<boolean>} - True if connection successful, false otherwise
 */
async function connectAudioPorts(outputPortName, inputPortName) {
  try {
    console.log(`Attempting to connect ${outputPortName} to ${inputPortName} using pw-link...`);
    
    // Get output ports
    const { stdout: outputPorts } = await execPromise(`pw-link -o | grep ${outputPortName}`);
    console.log('Available output ports:', outputPorts);
    
    // Get input ports
    const { stdout: inputPorts } = await execPromise(`pw-link -i | grep ${inputPortName}`);
    console.log('Available input ports:', inputPorts);
    
    // Get existing links
    console.log(`Checking existing links between ${outputPortName} and ${inputPortName}...`);
    const { stdout: existingLinks } = await execPromise('pw-link -l').catch(() => ({ stdout: '' }));
    console.log('Checking for existing links to disconnect...');
    
    // Parse the output to find links to disconnect
    const lines = existingLinks.split('\n');
    const linksToDisconnect = [];
    
    // Process the output to find connections
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check if this is an input port line for the target input
      if (line.startsWith(`input.${inputPortName}:`)) {
        const inputPort = line;
        
        // Look at the next lines for connections (they start with |<-)
        let j = i + 1;
        while (j < lines.length && lines[j].trim().startsWith('|<-')) {
          const outputPortLine = lines[j].trim();
          const outputPort = outputPortLine.substring(3).trim(); // Remove the '|<-' prefix
          
          // Add this connection to our list to disconnect
          linksToDisconnect.push({
            output: outputPort,
            input: inputPort
          });
          
          j++;
        }
      }
      
      // Also check for output lines that connect to the target input
      if (!line.startsWith(`input.${inputPortName}:`) && !line.startsWith('|')) {
        const outputPort = line;
        
        // Look at the next lines for connections (they start with |->)
        let j = i + 1;
        while (j < lines.length && lines[j].trim().startsWith('|->')) {
          const inputPortLine = lines[j].trim();
          const inputPort = inputPortLine.substring(3).trim(); // Remove the '|->' prefix
          
          // Check if this connects to our target input
          if (inputPort.startsWith(`input.${inputPortName}:`)) {
            // Add this connection to our list to disconnect
            linksToDisconnect.push({
              output: outputPort,
              input: inputPort
            });
          }
          
          j++;
        }
      }
    }
    
    // Disconnect all found links
    if (linksToDisconnect.length > 0) {
      console.log(`Found ${linksToDisconnect.length} links to disconnect`);
      
      for (const link of linksToDisconnect) {
        console.log(`Disconnecting: "${link.output}" from "${link.input}"`);
        try {
          await execPromise(`pw-link -d "${link.output}" "${link.input}"`);
          console.log('Link disconnected successfully');
        } catch (disconnectError) {
          console.error('Failed to disconnect link:', disconnectError.message);
        }
      }
    } else {
      console.log(`No existing links to ${inputPortName} found`);
    }
    
    // Parse the output and input ports into arrays
    const outputPortsArray = outputPorts.split('\n').filter(Boolean);
    const inputPortsArray = inputPorts.split('\n').filter(Boolean);
    
    if (outputPortsArray.length === 0 || inputPortsArray.length === 0) {
      console.error('No matching audio ports found');
      return false;
    }
    
    // Check for existing connections for each pair of ports we want to connect
    let allConnected = true;
    let existingCount = 0;
    let newCount = 0;
    
    // Get the list of existing links once to check against
    const { stdout: currentLinks } = await execPromise('pw-link -l').catch(() => ({ stdout: '' }));
    
    // Connect each output port to each input port
    for (let i = 0; i < Math.min(outputPortsArray.length, inputPortsArray.length); i++) {
      const outputPort = outputPortsArray[i];
      const inputPort = inputPortsArray[i];
      
      // Format port names for checking existing connections
      // Remove leading "output." or "input." if present for comparison
      const formattedOutputPort = outputPort.replace(/^output\./, '');
      const formattedInputPort = inputPort.replace(/^input\./, '');
      
      // Check if this connection already exists
      const connectionExists = currentLinks.includes(`${formattedOutputPort}`) && 
                               currentLinks.includes(`${formattedInputPort}`) &&
                               (currentLinks.includes(`${formattedOutputPort} -> ${formattedInputPort}`) || 
                                currentLinks.includes(`${formattedInputPort} <- ${formattedOutputPort}`));
      
      if (connectionExists) {
        console.log(`Connection already exists: Channel ${i+1}: "${outputPort}" to "${inputPort}"`);
        existingCount++;
        continue; // Skip this pair since they're already connected
      }
      
      console.log(`Connecting channel ${i+1}: "${outputPort}" to "${inputPort}"`);
      
      try {
        await execPromise(`pw-link "${outputPort}" "${inputPort}"`);
        console.log(`Successfully connected channel ${i+1}`);
        newCount++;
      } catch (error) {
        // Check if the error is "File exists" which means the connection already exists
        if (error.stderr && error.stderr.includes('File exists')) {
          console.log(`Connection already exists (detected during linking): Channel ${i+1}`);
          existingCount++;
        } else {
          console.error(`Failed to connect audio devices: ${error}`);
          allConnected = false;
        }
      }
    }
    
    console.log(`Connection summary: ${newCount} new connections, ${existingCount} existing connections`);
    
    // Return true if all connections were established or already exist
    return allConnected;
  } catch (error) {
    console.error('Failed to connect audio devices:', error);
    console.log('Devices created but not connected. Manual connection may be required.');
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

    // Connect sokuji_virtual_mic input to sokuji_virtual_output.monitor using the new method
    const connectionResult = await connectAudioPorts('sokuji_virtual_output', 'sokuji_virtual_mic');
    return connectionResult || true; // Still return true even if connection failed but devices were created
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
    
    // Check for any orphaned PipeWire loopback modules or connections
    try {
      // Clean up any orphaned connections related to our virtual devices
      console.log('Checking for orphaned PipeWire connections...');
      
      // Get existing links
      const { stdout: existingLinks } = await execPromise('pw-link -l').catch(() => ({ stdout: '' }));
      
      if (existingLinks.includes('sokuji_virtual')) {
        console.log('Found orphaned PipeWire connections, cleaning up...');
        
        // Parse the output to find links to disconnect
        const lines = existingLinks.split('\n');
        let disconnectedCount = 0;
        
        // First pass: Find all connections involving our virtual devices
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          
          // Check if this line mentions our virtual devices
          if (line.includes('sokuji_virtual')) {
            // If it's a port line, check the next lines for connections
            if (!line.startsWith('|')) {
              const port = line;
              
              // Look at the next lines for connections
              let j = i + 1;
              while (j < lines.length && lines[j].trim().startsWith('|')) {
                const connectionLine = lines[j].trim();
                let connectedPort;
                
                if (connectionLine.startsWith('|->')) {
                  // This is an output connection
                  connectedPort = connectionLine.substring(3).trim();
                  try {
                    await execPromise(`pw-link -d "${port}" "${connectedPort}"`);
                    console.log(`Disconnected orphaned link: ${port} -> ${connectedPort}`);
                    disconnectedCount++;
                  } catch (disconnectError) {
                    console.error('Failed to disconnect orphaned link:', disconnectError.message);
                  }
                } else if (connectionLine.startsWith('|<-')) {
                  // This is an input connection
                  connectedPort = connectionLine.substring(3).trim();
                  try {
                    await execPromise(`pw-link -d "${connectedPort}" "${port}"`);
                    console.log(`Disconnected orphaned link: ${connectedPort} -> ${port}`);
                    disconnectedCount++;
                  } catch (disconnectError) {
                    console.error('Failed to disconnect orphaned link:', disconnectError.message);
                  }
                }
                
                j++;
              }
            }
          }
        }
        
        console.log(`Cleaned up ${disconnectedCount} orphaned PipeWire connections`);
      }
    } catch (error) {
      console.error('Error cleaning up orphaned PipeWire connections:', error);
    }
    
    // Check for sokuji_virtual_speaker
    const { stdout: speakerList } = await execPromise('pactl list sinks short');
    if (speakerList.includes('sokuji_virtual_speaker')) {
      console.log('Found orphaned virtual speaker, cleaning up...');
      try {
        const { stdout: moduleInfo } = await execPromise('pactl list modules short | grep sokuji_virtual_speaker');
        const moduleId = moduleInfo.split('\t')[0];
        if (moduleId) {
          execSync(`pactl unload-module ${moduleId}`);
          console.log(`Cleaned up orphaned speaker module: ${moduleId}`);
        }
      } catch (error) {
        console.error('Error cleaning up orphaned speaker:', error);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error checking for orphaned devices:', error);
    return false;
  }
}

/**
 * Connect the virtual speaker's monitor port to a specific output device
 * @param {Object} deviceInfo - Information about the output device
 * @param {string} deviceInfo.deviceId - The device ID from the browser API
 * @param {string} deviceInfo.label - The human-readable label of the device
 * @returns {Promise<boolean>} - True if connection successful, false otherwise
 */
async function connectVirtualSpeakerToOutput(deviceInfo) {
  try {
    console.log(`Connecting Sokuji_Virtual_Speaker monitor to output device: ${deviceInfo.label} (ID: ${deviceInfo.deviceId})`);
    
    // First, disconnect any existing connections from the virtual speaker
    await disconnectVirtualSpeakerFromOutputs();
    
    // Find the PipeWire node based on the device description/label
    // Use grep to search for the node with a matching description
    const { stdout: nodeList } = await execPromise('pw-cli ls Node');
    console.log('Searching for matching PipeWire node...');
    
    // Parse the node list to find the matching node
    const lines = nodeList.split('\n');
    let nodeId = null;
    let nodeName = null;
    let nodeDescription = null;
    let currentId = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check for node ID line
      if (line.startsWith('id ') && line.includes('type PipeWire:Interface:Node')) {
        const idMatch = line.match(/id (\d+)/);
        if (idMatch) {
          currentId = idMatch[1];
        }
      }
      
      // Check for node description that matches our device label
      if (line.includes('node.description') && currentId) {
        const descMatch = line.match(/node\.description = "([^"]+)"/);
        if (descMatch && descMatch[1]) {
          // Check if this description matches our device label
          const description = descMatch[1];
          
          // Use a fuzzy match to account for slight differences in naming
          if (description.includes(deviceInfo.label) || deviceInfo.label.includes(description)) {
            nodeDescription = description;
            nodeId = currentId;
            
            // Now find the node name for this ID
            for (let j = i; j < Math.min(i + 10, lines.length); j++) {
              if (lines[j].includes('node.name') && lines[j].includes('=')) {
                const nameMatch = lines[j].match(/node\.name = "([^"]+)"/);
                if (nameMatch && nameMatch[1]) {
                  nodeName = nameMatch[1];
                  break;
                }
              }
            }
            
            if (nodeName) {
              break; // We found everything we need
            }
          }
        }
      }
      
      // Also check for node name that matches "Default" device
      if (deviceInfo.deviceId === 'default' && line.includes('node.name') && line.includes('=') && currentId) {
        // For "Default" device, try to find the default sink
        // This is typically the first Audio/Sink in the list
        const nameMatch = line.match(/node\.name = "([^"]+)"/);
        if (nameMatch && nameMatch[1]) {
          const potentialNodeName = nameMatch[1];
          
          // Check if this is an Audio/Sink in nearby lines
          for (let j = Math.max(0, i - 5); j < Math.min(i + 5, lines.length); j++) {
            if (lines[j].includes('media.class') && lines[j].includes('Audio/Sink')) {
              // This is an Audio/Sink, so it's a potential match for "Default"
              nodeName = potentialNodeName;
              nodeId = currentId;
              nodeDescription = 'Default Audio Sink';
              break;
            }
          }
          
          if (nodeName) {
            break; // We found a default sink
          }
        }
      }
    }
    
    if (!nodeName) {
      // If we still don't have a node name, try a different approach for finding the node
      // Look for any sink that has a description or name containing parts of our label
      console.log('No exact match found, trying alternative matching approach...');
      
      // Reset for second pass
      currentId = null;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Check for node ID line
        if (line.startsWith('id ') && line.includes('type PipeWire:Interface:Node')) {
          const idMatch = line.match(/id (\d+)/);
          if (idMatch) {
            currentId = idMatch[1];
          }
        }
        
        // Check if this is an Audio/Sink
        if (line.includes('media.class') && line.includes('Audio/Sink') && currentId) {
          // This is an Audio/Sink, so look for its name and description
          let tempNodeName = null;
          let tempNodeDescription = null;
          
          // Look at nearby lines for name and description
          for (let j = Math.max(0, i - 10); j < Math.min(i + 10, lines.length); j++) {
            if (lines[j].includes('node.name') && lines[j].includes('=')) {
              const nameMatch = lines[j].match(/node\.name = "([^"]+)"/);
              if (nameMatch && nameMatch[1]) {
                tempNodeName = nameMatch[1];
              }
            }
            
            if (lines[j].includes('node.description') && lines[j].includes('=')) {
              const descMatch = lines[j].match(/node\.description = "([^"]+)"/);
              if (descMatch && descMatch[1]) {
                tempNodeDescription = descMatch[1];
              }
            }
          }
          
          // If we found both name and description, check for a partial match
          if (tempNodeName && tempNodeDescription) {
            // Split the device label into words for partial matching
            const labelWords = deviceInfo.label.toLowerCase().split(/\s+/);
            const descriptionLower = tempNodeDescription.toLowerCase();
            
            // Check if any significant word from the label appears in the description
            const hasMatch = labelWords.some(word => 
              word.length > 3 && descriptionLower.includes(word.toLowerCase())
            );
            
            if (hasMatch) {
              nodeName = tempNodeName;
              nodeId = currentId;
              nodeDescription = tempNodeDescription;
              break;
            }
          }
        }
      }
    }
    
    if (!nodeName) {
      console.error(`Could not find PipeWire node for device: ${deviceInfo.label}`);
      return false;
    }
    
    console.log(`Found PipeWire node: ${nodeName} (ID: ${nodeId}, Description: ${nodeDescription})`);
    
    // Use the connectAudioPorts function to connect the virtual speaker monitor to the output device
    // The virtual speaker's monitor output is named "sokuji_virtual_output.monitor"
    const result = await connectAudioPorts('sokuji_virtual_output.monitor', nodeName);
    
    if (result) {
      console.log(`Successfully connected sokuji_virtual_output.monitor to ${nodeName}`);
      return true;
    } else {
      console.error(`Failed to connect sokuji_virtual_output.monitor to ${nodeName}`);
      return false;
    }
  } catch (error) {
    console.error('Failed to connect virtual speaker to output device:', error);
    return false;
  }
}

/**
 * Disconnect any existing connections from the virtual speaker's monitor port,
 * except for the connection to sokuji_virtual_mic
 * @returns {Promise<boolean>} - True if disconnection successful, false otherwise
 */
async function disconnectVirtualSpeakerFromOutputs() {
  try {
    console.log('Disconnecting virtual speaker monitor from output devices (preserving sokuji_virtual_mic connection)...');
    
    // Get existing links
    const { stdout: existingLinks } = await execPromise('pw-link -l').catch(() => ({ stdout: '' }));

    // Parse the output to find links to disconnect
    const lines = existingLinks.split('\n');
    const linksToDisconnect = [];
    
    // Process the output to find connections from sokuji_virtual_output:monitor_*
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check if this is an output port line for the virtual speaker monitor
      // Format is like "sokuji_virtual_output:monitor_FL" or "sokuji_virtual_output:monitor_FR"
      if (line.includes('sokuji_virtual_output:monitor_')) {
        const outputPort = line;
        
        // Look at the next lines for connections (they start with |->)
        let j = i + 1;
        while (j < lines.length && lines[j].trim().startsWith('|->')) {
          const inputPortLine = lines[j].trim();
          const inputPort = inputPortLine.substring(3).trim(); // Remove the '|->' prefix
          
          // Only add to disconnect list if it's NOT connected to sokuji_virtual_mic
          if (!inputPort.includes('sokuji_virtual_mic')) {
            // Add this connection to our list to disconnect
            linksToDisconnect.push({
              output: outputPort,
              input: inputPort
            });
          } else {
            console.log(`Preserving connection from ${outputPort} to ${inputPort}`);
          }
          
          j++;
        }
      }
    }
    
    // Disconnect all found links (except sokuji_virtual_mic)
    if (linksToDisconnect.length > 0) {
      console.log(`Found ${linksToDisconnect.length} links to disconnect (excluding sokuji_virtual_mic)`);
      
      for (const link of linksToDisconnect) {
        console.log(`Disconnecting: "${link.output}" from "${link.input}"`);
        try {
          await execPromise(`pw-link -d "${link.output}" "${link.input}"`);
          console.log('Link disconnected successfully');
        } catch (disconnectError) {
          console.error('Failed to disconnect link:', disconnectError.message);
        }
      }
      return true;
    } else {
      console.log('No links to disconnect (or only sokuji_virtual_mic connection exists)');
      return true; // No links to disconnect is still a success
    }
  } catch (error) {
    console.error('Failed to disconnect virtual speaker from outputs:', error);
    return false;
  }
}

module.exports = {
  createVirtualAudioDevices,
  removeVirtualAudioDevices,
  isPulseAudioAvailable,
  cleanupOrphanedDevices,
  connectAudioPorts,
  connectVirtualSpeakerToOutput,
  disconnectVirtualSpeakerFromOutputs
};