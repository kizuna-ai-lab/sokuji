// Virtual Microphone implementation
// This script overrides enumerateDevices and getUserMedia to create a virtual microphone
// that can be used to inject audio into web applications

// Configuration
const VIRTUAL_DEVICE_ID = 'sokuji-virtual-microphone';
const VIRTUAL_DEVICE_LABEL = 'Sokuji_Virtual_Mic';
const BUFFER_SIZE = 4096;

// Use a much larger queue for test tones (audio files can be several minutes long)
const MAX_QUEUED_SAMPLES = 5000; // Can handle ~5 minutes of audio at typical chunk sizes
const QUEUE_WARNING_THRESHOLD = 1000; // Warn when queue gets very large
const QUEUE_CRITICAL_THRESHOLD = 4000; // Critical warning level

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
    // 使用固定的采样率24kHz与发送过来的数据匹配
    audioContext = new AudioContext({
      latencyHint: 'interactive',
      sampleRate: 24000 // 使用与BrowserAudioService发送的数据相同的采样率
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
    
    // Create buffer for audio data that doesn't fit in a single processing cycle
    let leftoverBuffer = null;
    let leftoverPosition = 0;
    
    // Process audio data from the queue
    processorNode.onaudioprocess = (e) => {
      const outputBuffer = e.outputBuffer;
      const outputData = outputBuffer.getChannelData(0);
      const outputLength = outputData.length;
      
      // Track how many samples we've filled in the output buffer
      let filledSamples = 0;
      
      // First use any leftover data from previous processing
      if (leftoverBuffer && leftoverPosition < leftoverBuffer.length) {
        const remaining = leftoverBuffer.length - leftoverPosition;
        const copyLength = Math.min(remaining, outputLength);
        
        for (let i = 0; i < copyLength; i++) {
          outputData[i] = leftoverBuffer[leftoverPosition + i];
        }
        
        filledSamples += copyLength;
        leftoverPosition += copyLength;
        
        // Clear leftover buffer if we've used all of it
        if (leftoverPosition >= leftoverBuffer.length) {
          leftoverBuffer = null;
          leftoverPosition = 0;
        }
      }
      
      // Process audio chunks from the queue until output buffer is full
      while (filledSamples < outputLength && audioQueue.length > 0) {
        // Get the oldest audio chunk from the queue
        const audioChunk = audioQueue.shift();
        
        // Skip invalid chunks
        if (!audioChunk || !audioChunk.channelData || !audioChunk.channelData[0]) {
          continue;
        }
        
        const inputData = audioChunk.channelData[0];
        const remainingSpace = outputLength - filledSamples;
        
        if (inputData.length <= remainingSpace) {
          // The entire chunk fits in the output buffer
          for (let i = 0; i < inputData.length; i++) {
            outputData[filledSamples + i] = inputData[i];
          }
          filledSamples += inputData.length;
        } else {
          // Fill what we can
          for (let i = 0; i < remainingSpace; i++) {
            outputData[filledSamples + i] = inputData[i];
          }
          
          // Store the rest for next time
          const leftoverSize = inputData.length - remainingSpace;
          leftoverBuffer = new Float32Array(leftoverSize);
          for (let i = 0; i < leftoverSize; i++) {
            leftoverBuffer[i] = inputData[remainingSpace + i];
          }
          leftoverPosition = 0;
          
          filledSamples = outputLength; // Buffer is now full
        }
        
        lastActivityTimestamp = Date.now();
      }
      
      // If we didn't completely fill the buffer, fill the rest with silence
      if (filledSamples < outputLength) {
        for (let i = filledSamples; i < outputLength; i++) {
          outputData[i] = 0;
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
  // Dynamic queue management system to handle test tones and other extremely large audio inputs
  const queueStats = {
    totalAccepted: 0,    // Total samples accepted
    totalDropped: 0,     // Total samples dropped
    lastReportTime: 0,   // Last time we reported stats
    reportInterval: 5000 // Report stats every 5 seconds when queue is under pressure
  };

  window.sokujiInjectAudio = (audioData) => {
    if (!audioData || !audioContext) {
      console.error('[Sokuji] Cannot inject audio: invalid data or audio context not ready');
      return false;
    }
    
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
        console.error('[Sokuji] Invalid audio data format');
        return false;
      }

      // Calculate current audio backlog in seconds
      let totalQueuedSamples = 0;
      for (const item of audioQueue) {
        if (item && item.channelData && item.channelData[0]) {
          totalQueuedSamples += item.channelData[0].length;
        }
      }
      const queuedSeconds = totalQueuedSamples / (audioData.sampleRate || 24000);
      
      // Detect test tones (very large audio chunks) vs. regular streaming audio
      const isLargeAudioChunk = audioData.channelData[0].length > 10000; // Typical test tone is much larger
      
      // Adaptive queue management based on current state
      if (audioQueue.length >= QUEUE_CRITICAL_THRESHOLD) {
        // CRITICAL: Queue is almost at maximum capacity
        // Drop more aggressively to avoid complete stall
        if (audioQueue.length % 100 === 0) {
          console.warn(`[Sokuji] CRITICAL: Queue at ${audioQueue.length}/${MAX_QUEUED_SAMPLES} (${queuedSeconds.toFixed(1)}s of audio)`);
        }
        
        // Drop 10% of the oldest samples to make more room
        if (isLargeAudioChunk) {
          const toDrop = Math.ceil(audioQueue.length * 0.1);
          for (let i = 0; i < toDrop; i++) {
            audioQueue.shift();
            queueStats.totalDropped++;
          }
          console.warn(`[Sokuji] Dropped ${toDrop} samples to make room for large audio chunk`);
        }
      } 
      else if (audioQueue.length >= QUEUE_WARNING_THRESHOLD) {
        // WARNING: Queue is getting large but still manageable
        // Log warnings less frequently to reduce console spam
        if (audioQueue.length % 500 === 0) {
          console.warn(`[Sokuji] Queue pressure: ${audioQueue.length}/${MAX_QUEUED_SAMPLES} (${queuedSeconds.toFixed(1)}s of audio)`);
        }
      }
      
      // Final decision on what to do with this sample
      if (audioQueue.length < MAX_QUEUED_SAMPLES) {
        // We have room, add the sample
        audioQueue.push(audioData);
        queueStats.totalAccepted++;
        lastActivityTimestamp = Date.now();
        return true;
      } else {
        // Queue is full - must drop something
        // Find and drop the oldest/smallest sample to maximize quality
        let smallestIndex = 0;
        let smallestSize = Infinity;
        
        // Look through the first 50 items to find a smaller one to drop
        // (avoids scanning the entire queue which could be expensive)
        const scanLength = Math.min(50, audioQueue.length);
        for (let i = 0; i < scanLength; i++) {
          const item = audioQueue[i];
          if (item && item.channelData && item.channelData[0] && 
              item.channelData[0].length < smallestSize) {
            smallestSize = item.channelData[0].length;
            smallestIndex = i;
          }
        }
        
        // Remove the smallest sample if we found one, otherwise the oldest
        if (smallestSize < audioData.channelData[0].length) {
          audioQueue.splice(smallestIndex, 1);
        } else {
          audioQueue.shift(); // Remove oldest if all are large
        }
        
        queueStats.totalDropped++;
        audioQueue.push(audioData);
        queueStats.totalAccepted++;
        
        // Periodically report drop statistics
        const now = Date.now();
        if (now - queueStats.lastReportTime > queueStats.reportInterval) {
          console.warn(`[Sokuji] Queue full: ${queueStats.totalAccepted} samples accepted, ${queueStats.totalDropped} dropped (${(queueStats.totalDropped / (queueStats.totalAccepted + queueStats.totalDropped) * 100).toFixed(1)}% drop rate)`);
          queueStats.lastReportTime = now;
        }
        
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
// Audio chunk buffer for reassembly
const audioChunkBuffer = {
  chunks: [],
  lastProcessedChunk: -1,
  processingTimer: null,
  
  // Add a chunk to the buffer
  addChunk(chunk) {
    // Add metadata if not present
    if (chunk.chunkIndex === undefined) {
      // Legacy format (non-chunked) - process immediately
      return window.sokujiInjectAudio(chunk);
    }
    
    // Store the chunk
    this.chunks[chunk.chunkIndex] = chunk;
    
    // Process chunks if we have a complete sequence or enough chunks
    this.scheduleProcessing();
    return true;
  },
  
  // Schedule processing to happen soon (debounced)
  scheduleProcessing() {
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
    }
    
    this.processingTimer = setTimeout(() => {
      this.processAvailableChunks();
    }, 10); // Small delay to allow more chunks to arrive
  },
  
  // Process any available chunks in sequence
  processAvailableChunks() {
    // Start from the last processed chunk index + 1
    let nextIndex = this.lastProcessedChunk + 1;
    
    // Process chunks in sequence as long as we have contiguous chunks
    while (this.chunks[nextIndex] !== undefined) {
      const chunk = this.chunks[nextIndex];
      
      // Process the chunk
      const success = window.sokujiInjectAudio(chunk);
      if (!success) {
        console.warn(`[Sokuji] Failed to inject chunk ${nextIndex}/${chunk.totalChunks}`);
        
        // Try to reinitialize if injection failed
        if (!isCapturing) {
          console.warn('[Sokuji] Audio injection failed, reinitializing...');
          startCapturing();
          
          // Try again after reinitialization
          window.sokujiInjectAudio(chunk);
        }
      }
      
      // Remove processed chunk to free memory
      delete this.chunks[nextIndex];
      
      // Update last processed index
      this.lastProcessedChunk = nextIndex;
      nextIndex++;
    }
    
    // Clean up old chunks that were missed (prevent memory leaks)
    this.cleanupOldChunks();
  },
  
  // Remove any chunks that are too old to be useful
  cleanupOldChunks() {
    const MAX_CHUNK_GAP = 50; // Maximum number of chunks to wait for before skipping
    const keys = Object.keys(this.chunks).map(Number).sort((a, b) => a - b);
    
    if (keys.length > 0) {
      // If we have chunks far ahead of what we've processed, jump ahead
      if (keys[0] > this.lastProcessedChunk + MAX_CHUNK_GAP) {
        console.warn(`[Sokuji] Skipping ${keys[0] - this.lastProcessedChunk} missing chunks`);
        // Start processing from the earliest available chunk
        this.lastProcessedChunk = keys[0] - 1;
        this.scheduleProcessing();
      }
    }
    
    // If buffer gets too large, clear old chunks
    if (keys.length > 100) {
      console.warn(`[Sokuji] Chunk buffer too large (${keys.length}), clearing old chunks`);
      // Keep only the newest 50 chunks
      keys.slice(0, keys.length - 50).forEach(key => {
        delete this.chunks[key];
      });
    }
  },
  
  // Reset the buffer
  reset() {
    this.chunks = [];
    this.lastProcessedChunk = -1;
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
    }
  }
};

// Listen for PCM audio chunks posted from content script and inject into virtual mic
window.addEventListener('message', (event) => {
  if (event.source === window && event.data?.type === 'AUDIO_CHUNK') {
    audioChunkBuffer.addChunk(event.data.data);
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

