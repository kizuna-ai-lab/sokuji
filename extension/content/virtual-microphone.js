// Virtual Microphone implementation
// This script overrides enumerateDevices and getUserMedia to create a virtual microphone
// that can be used to inject audio into web applications

// Configuration
const VIRTUAL_DEVICE_ID = 'sokuji-virtual-microphone';
const VIRTUAL_DEVICE_LABEL = 'Sokuji_Virtual_Mic';
const BUFFER_SIZE = 4096;
const MAX_QUEUED_SAMPLES = 10; // Prevent memory issues by limiting queue size

// Store original methods
const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

// Audio processing variables
let audioContext = null;
let virtualStream = null;
let isCapturing = false;
let audioQueue = [];
let processorNode = null;
let gainNode = null;

// Safety checks and cleanup
let lastActivityTimestamp = Date.now();
const CLEANUP_INTERVAL = 60000; // 1 minute
let cleanupInterval = null;

// Initialize audio context and nodes with modern Web Audio API
function initAudioContext() {
  if (audioContext && audioContext.state !== 'closed') {
    // If context exists but is suspended, resume it
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(err => {
        console.error('[Sokuji] Failed to resume AudioContext:', err);
        // If resume fails, recreate the context
        audioContext.close().catch(() => {});
        audioContext = null;
        initAudioContext();
      });
    }
    return;
  }
  
  try {
    console.log('[Sokuji] Initializing AudioContext');
    // 使用默认采样率以匹配输入数据
    audioContext = new AudioContext({
      latencyHint: 'interactive'
      // 不指定sampleRate, 让浏览器选择最合适的值
    });
    
    // Ensure audio context is running
    if (audioContext.state !== 'running') {
      audioContext.resume().catch(err => console.warn('[Sokuji] AudioContext resume failed', err));
    }
    
    // Create gain node to control volume
    gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0; // Normal volume
    
    // Create nodes for continuous audio processing using ScriptProcessorNode
    // (AudioWorkletNode would be better but requires more setup)
    processorNode = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
    
    // Process audio data from the queue
    processorNode.onaudioprocess = (e) => {
      const outputBuffer = e.outputBuffer;
      const outputData = outputBuffer.getChannelData(0);
      
      // Fill output with silence by default
      outputData.fill(0);
      
      if (audioQueue.length > 0) {
        // Get the oldest audio chunk from the queue
        const audioChunk = audioQueue.shift();
        
        // Process valid chunks
        if (audioChunk && audioChunk.channelData && audioChunk.channelData[0]) {
          const inputData = audioChunk.channelData[0];
          const length = Math.min(outputData.length, inputData.length);
          for (let i = 0; i < length; i++) {
            outputData[i] = inputData[i];
          }
          
          lastActivityTimestamp = Date.now();
        }
      }
    };
    
    // Connect the processor node to the gain node
    processorNode.connect(gainNode);
    
    // Create a MediaStreamDestination to get a MediaStream
    const destinationNode = audioContext.createMediaStreamDestination();
    
    // Connect the gain node to the destination
    gainNode.connect(destinationNode);
    
    // Get the MediaStream from the destination node
    virtualStream = destinationNode.stream;
    
    // Start cleanup interval
    if (!cleanupInterval) {
      cleanupInterval = setInterval(checkAndCleanup, CLEANUP_INTERVAL);
    }
    
    console.log('[Sokuji] Virtual microphone audio context initialized:', {
      state: audioContext.state,
      sampleRate: audioContext.sampleRate
    });
  } catch (error) {
    console.error('[Sokuji] Failed to initialize audio context:', error);
    
    // Try to clean up if initialization fails
    if (processorNode) {
      try {
        processorNode.disconnect();
      } catch (e) {}
      processorNode = null;
    }
    
    if (gainNode) {
      try {
        gainNode.disconnect();
      } catch (e) {}
      gainNode = null;
    }
    
    if (audioContext) {
      try {
        audioContext.close();
      } catch (e) {}
      audioContext = null;
    }
  }
}

// Check for inactivity and clean up resources if needed
function checkAndCleanup() {
  const now = Date.now();
  const inactiveTime = now - lastActivityTimestamp;
  
  // If no activity for 5 minutes, clean up resources
  if (inactiveTime > 300000) {
    console.log('[Sokuji] Cleaning up inactive audio resources');
    cleanupAudioResources();
  }
}

// Clean up audio resources
function cleanupAudioResources() {
  // Clear the audio queue
  audioQueue = [];
  
  // Disconnect and nullify nodes
  if (processorNode) {
    try {
      processorNode.disconnect();
    } catch (e) {}
    processorNode = null;
  }
  
  if (gainNode) {
    try {
      gainNode.disconnect();
    } catch (e) {}
    gainNode = null;
  }
  
  // Close audio context
  if (audioContext) {
    try {
      audioContext.close();
    } catch (e) {}
    audioContext = null;
  }
  
  // Clear the virtual stream
  virtualStream = null;
  isCapturing = false;
  
  // Clear the cleanup interval
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  
  console.log('[Sokuji] Audio resources cleaned up');
}

// Setup API for receiving audio data from external sources
function setupAudioAPI() {
  // Create a global function that can be called to inject audio data
  window.sokujiInjectAudio = (audioData) => {
    if (!audioData || !audioContext) {
      console.error('[Sokuji] Cannot inject audio: invalid data or audio context not ready');
      return false;
    }
    console.log('[Sokuji] Injecting audio data:', audioData);
    
    try {
      // Ensure audio context is running
      if (audioContext.state !== 'running') {
        audioContext.resume().catch(err => console.warn('[Sokuji] AudioContext resume failed', err));
      }
      
      // Basic validation of audioData
      if (!audioData.channelData || 
          !Array.isArray(audioData.channelData) || 
          audioData.channelData.length === 0 ||
          !audioData.channelData[0] ||
          !audioData.channelData[0].length) {
        console.error('[Sokuji] Invalid audio data format:', audioData);
        return false;
      }
      
      // Add audio data to queue, limiting queue size to prevent memory issues
      if (audioQueue.length < MAX_QUEUED_SAMPLES) {
        audioQueue.push(audioData);
        lastActivityTimestamp = Date.now();
        return true;
      } else {
        console.warn('[Sokuji] Audio queue full, dropping oldest sample');
        // Remove oldest sample and add new one
        audioQueue.shift();
        audioQueue.push(audioData);
        return true;
      }
    } catch (error) {
      console.error('[Sokuji] Error processing audio data:', error);
      return false;
    }
  };
  
  console.log('[Sokuji] Audio injection API set up');
}

// Start capturing audio
function startCapturing() {
  if (isCapturing && audioContext && audioContext.state !== 'closed') {
    console.log('[Sokuji] Virtual microphone already active');
    return;
  }
  
  console.log('[Sokuji] Starting virtual microphone');
  
  // Initialize audio context and nodes
  initAudioContext();
  
  // Set up the API for injecting audio
  setupAudioAPI();
  
  isCapturing = true;
  lastActivityTimestamp = Date.now();
  
  console.log('[Sokuji] Virtual microphone ready for audio injection');
}

// Override enumerateDevices to include our virtual device
navigator.mediaDevices.enumerateDevices = async function() {
  const devices = await originalEnumerateDevices();
  
  // Check if our virtual device is already in the list
  const virtualDeviceExists = devices.some(device => 
    device.deviceId === VIRTUAL_DEVICE_ID && device.kind === 'audioinput'
  );
  
  if (!virtualDeviceExists) {
    // Add our virtual device to the list
    devices.push({
      deviceId: VIRTUAL_DEVICE_ID,
      kind: 'audioinput',
      label: VIRTUAL_DEVICE_LABEL,
      groupId: VIRTUAL_DEVICE_ID
    });
  }
  
  return devices;
};

// Override getUserMedia to handle requests for our virtual device
navigator.mediaDevices.getUserMedia = async function(constraints) {
  // Make a copy of the constraints object to avoid modifying the original
  const newConstraints = structuredClone(constraints);
  
  // Only intercept when audio is specifically requesting our virtual device
  if (newConstraints && newConstraints.audio) {
    const isVirtualDeviceExactlyRequested = 
      typeof newConstraints.audio === 'object' && 
      newConstraints.audio.deviceId && 
      ((newConstraints.audio.deviceId.exact === VIRTUAL_DEVICE_ID) || 
       (newConstraints.audio.deviceId === VIRTUAL_DEVICE_ID));
       
    const isVirtualDeviceIdeallyRequested =
      typeof newConstraints.audio === 'object' && 
      newConstraints.audio.deviceId && 
      Array.isArray(newConstraints.audio.deviceId.ideal) && 
      newConstraints.audio.deviceId.ideal.includes(VIRTUAL_DEVICE_ID);
    
    // Only intercept if our specific virtual microphone is requested
    if (isVirtualDeviceExactlyRequested || isVirtualDeviceIdeallyRequested) {
      console.log('[Sokuji] Virtual microphone specifically requested');
      
      // Initialize our virtual microphone
      startCapturing();
      
      // Wait for audio context to be fully initialized
      if (!virtualStream) {
        console.warn('[Sokuji] Waiting for virtual stream to be ready...');
        // Wait up to 1 second for the virtual stream to be ready
        for (let i = 0; i < 10; i++) {
          if (virtualStream) break;
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Try to initialize again if still not ready
          if (i === 5 && !virtualStream) {
            console.warn('[Sokuji] Retrying audio context initialization');
            initAudioContext();
          }
        }
      }
      
      if (!virtualStream) {
        console.error('[Sokuji] Failed to create virtual stream after multiple attempts');
        throw new Error('Failed to initialize virtual microphone');
      }
      
      // Only modify the audio constraints, leaving all other constraints unchanged
      // Get the original stream but replace only the audio track with our virtual track
      try {
        // Audio only request, return just our virtual audio stream
        console.log('[Sokuji] Returning virtual audio-only stream');
        return virtualStream;
      } catch (error) {
        console.error('[Sokuji] Error creating stream with virtual microphone:', error);
        throw error; // Re-throw to maintain original error behavior
      }
    }
  }
  
  // For all other requests (including general audio requests), use the original implementation
  return originalGetUserMedia(constraints);
};

// Initialize everything immediately to ensure it's ready when needed
startCapturing();

// Listen for PCM audio chunks posted from content script and inject into virtual mic
window.addEventListener('message', (event) => {
  if (event.source === window && event.data?.type === 'AUDIO_CHUNK') {
    const success = window.sokujiInjectAudio(event.data.data);
    if (!success && !isCapturing) {
      // Try to reinitialize if injection failed and we're not capturing
      console.warn('[Sokuji] Audio injection failed, reinitializing...');
      startCapturing();
      // Try again after reinitialization
      window.sokujiInjectAudio(event.data.data);
    }
  }
});

// Add a periodic check to ensure audio context is running
setInterval(() => {
  if (audioContext && audioContext.state !== 'running') {
    console.warn('[Sokuji] AudioContext not running, attempting to resume...');
    audioContext.resume().catch(err => {
      console.error('[Sokuji] Failed to resume AudioContext:', err);
      // If resume fails consistently, we may need to reinitialize
      if (Date.now() - lastActivityTimestamp > 5000) {
        console.warn('[Sokuji] Reinitializing audio context due to persistent suspended state');
        initAudioContext();
      }
    });
  }
}, 5000);

// Expose API for debugging and control
window.sokujiVirtualMic = {
  startCapturing,
  audioContext,
  audioQueue,
  gainNode,
  processorNode,
  virtualStream,
  getStatus: () => ({ 
    isCapturing, 
    hasAudioContext: !!audioContext, 
    audioContextState: audioContext ? audioContext.state : 'none',
    sampleRate: audioContext ? audioContext.sampleRate : 0,
    hasVirtualStream: !!virtualStream,
    virtualStream,
    queueSize: audioQueue.length,
    lastActivityTime: new Date(lastActivityTimestamp).toISOString()
  }),
  clearQueue: () => {
    audioQueue = [];
    console.log('[Sokuji] Audio queue cleared');
  },
  setGain: (value) => {
    if (gainNode && typeof value === 'number') {
      gainNode.gain.value = Math.max(0, Math.min(2, value)); // Limit between 0 and 2
      console.log(`[Sokuji] Gain set to ${gainNode.gain.value}`);
      return true;
    }
    return false;
  }
};

console.log('[Sokuji] Virtual microphone script loaded and initialized');

