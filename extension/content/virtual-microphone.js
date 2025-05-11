// Virtual Microphone implementation for Sokuji
// This script creates a virtual microphone using WavStreamPlayer and overrides
// navigator.mediaDevices.enumerateDevices and getUserMedia to inject this virtual device

// Direct import of WavStreamPlayer and StreamProcessorWorkletCode from src - webpack will handle bundling
import { WavStreamPlayer } from '@lib/wavtools/index.js';
import { StreamProcessorWorkletCode } from '@lib/wavtools/lib/worklets/stream_processor.js';

// Configuration
const VIRTUAL_DEVICE_ID = 'sokuji-virtual-microphone';
const VIRTUAL_DEVICE_LABEL = 'Sokuji_Virtual_Mic';
const SAMPLE_RATE = 24000; // 24kHz to match BrowserAudioService

// Store original methods
const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

// Main state variables
let streamPlayer = null;
let virtualMediaStream = null;
let isInitialized = false;
let lastActivityTimestamp = Date.now();
let audioEnabled = true;
const CLEANUP_INTERVAL = 60000; // 1 minute
let cleanupInterval = null;

/**
 * Initialize the WavStreamPlayer
 * Creates and configures the WavStreamPlayer instance for virtual microphone use
 */
async function initWavStreamPlayer() {
  if (streamPlayer && streamPlayer.context && streamPlayer.context.state !== 'closed') {
    // Player already exists and is active
    return streamPlayer;
  }

  try {
    console.log('[Sokuji] Initializing WavStreamPlayer');
    
    // Create a new WavStreamPlayer instance directly, but don't use its scriptSrc
    streamPlayer = new WavStreamPlayer({ sampleRate: SAMPLE_RATE });
    
    // Create our own AudioContext instead of using connect() which tries to load the worklet
    streamPlayer.context = new AudioContext({ sampleRate: SAMPLE_RATE });
    
    // Resume the context if needed
    if (streamPlayer.context.state === 'suspended') {
      await streamPlayer.context.resume();
    }
    
    // Create a blob URL for our embedded AudioWorklet code
    const blob = new Blob([StreamProcessorWorkletCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    
    try {
      // Add the AudioWorklet module using our blob URL
      await streamPlayer.context.audioWorklet.addModule(workletUrl);
      console.log('[Sokuji] Successfully loaded AudioWorklet from blob URL');
    } catch (e) {
      console.error('[Sokuji] Error loading AudioWorklet:', e);
      throw new Error(`Could not add AudioWorklet module: ${e.message}`);
    } finally {
      // Clean up the blob URL
      URL.revokeObjectURL(workletUrl);
    }
    
    // Set up analyzer node
    const analyser = streamPlayer.context.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.1;
    streamPlayer.analyser = analyser;
    
    // Get the AudioContext from the player
    const audioContext = streamPlayer.context;
    
    // Create a MediaStreamDestination to get a MediaStream
    const destinationNode = audioContext.createMediaStreamDestination();
    
    // Create an intermediate gain node to control volume
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0; // normal volume
    
    // Get the node that would normally go to the speakers
    // and connect it to our destination instead
    const workletNode = new AudioWorkletNode(audioContext, 'stream_processor');
    
    // Connect the audio processing chain
    workletNode.connect(gainNode);
    gainNode.connect(destinationNode);
    
    // Store the new MediaStream for getUserMedia to return
    virtualMediaStream = destinationNode.stream;
    
    // Set up the communication with the worklet
    workletNode.port.onmessage = (e) => {
      const { event } = e.data;
      if (event === 'stop') {
        workletNode.disconnect();
        // We don't null the stream since we want to keep it available
      }
    };
    
    // Set up mechanism to post audio data to the worklet
    streamPlayer.customPostAudioToWorklet = (buffer, trackId) => {
      if (workletNode && workletNode.port) {
        workletNode.port.postMessage({ 
          event: 'write', 
          buffer, 
          trackId: trackId || 'default' 
        });
        return true;
      }
      return false;
    };
    
    // Set up cleanup interval
    if (!cleanupInterval) {
      cleanupInterval = setInterval(checkAndCleanup, CLEANUP_INTERVAL);
    }
    
    console.log('[Sokuji] Virtual microphone setup complete with WavStreamPlayer');
    isInitialized = true;
    lastActivityTimestamp = Date.now();
    
    return streamPlayer;
  } catch (error) {
    console.error('[Sokuji] Error during WavStreamPlayer initialization:', error);
    return null;
  }
}

/**
 * Check for inactivity and clean up resources if needed
 */
function checkAndCleanup() {
  const now = Date.now();
  const inactiveTime = now - lastActivityTimestamp;
  
  // If no activity for 5 minutes, clean up resources
  if (inactiveTime > 300000) { // 5 minutes in milliseconds
    console.log('[Sokuji] Detected inactivity for 5 minutes, cleaning up resources');
    cleanupAudioResources();
  }
}

/**
 * Clean up all audio resources
 */
function cleanupAudioResources() {
  try {
    // Clear the interval first
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
    
    // Clean up player if it exists
    if (streamPlayer) {
      // No need to explicitly close - the AudioContext will be closed if needed
      console.log('[Sokuji] Cleaning up WavStreamPlayer');
      streamPlayer = null;
    }
    
    // Reset all state variables
    virtualMediaStream = null;
    isInitialized = false;
    audioEnabled = true;
    
    console.log('[Sokuji] Audio resources cleaned up successfully');
  } catch (error) {
    console.error('[Sokuji] Error during audio resource cleanup:', error);
  }
}

/**
 * Add audio data to the stream player
 * @param {Int16Array|ArrayBuffer} audioData - The audio data to add
 * @param {string} [trackId='default'] - Optional track ID to identify the audio source
 */
function addAudioData(audioData, trackId = 'default') {
  lastActivityTimestamp = Date.now();
  
  if (!audioEnabled) {
    // Audio is disabled, don't process
    return;
  }
  
  // Lazily initialize WavStreamPlayer if needed
  if (!streamPlayer) {
    initWavStreamPlayer().then(player => {
      if (player) {
        // Try adding the data again after initialization
        addAudioData(audioData, trackId);
      }
    }).catch(error => {
      console.error('[Sokuji] Error initializing WavStreamPlayer for addAudioData:', error);
    });
    return;
  }
  
  try {
    // Convert ArrayBuffer to Int16Array if needed
    let int16Data;
    if (audioData instanceof Int16Array) {
      int16Data = audioData;
    } else if (audioData instanceof ArrayBuffer) {
      int16Data = new Int16Array(audioData);
    } else if (Array.isArray(audioData)) {
      // Handle array of numbers by converting to Int16Array
      int16Data = new Int16Array(audioData);
    } else {
      console.error('[Sokuji] Invalid audio data type:', typeof audioData);
      return;
    }
    
    // Use our custom method if available (this uses the worklet we set up)
    if (streamPlayer.customPostAudioToWorklet) {
      streamPlayer.customPostAudioToWorklet(int16Data, trackId);
    } else {
      // Fall back to standard method
      streamPlayer.add16BitPCM(int16Data, trackId);
    }
  } catch (error) {
    console.error('[Sokuji] Error adding audio data:', error);
  }
}

/**
 * Start capturing audio with the virtual microphone
 */
async function startCapturing() {
  try {
    const player = await initWavStreamPlayer();
    if (player) {
      console.log('[Sokuji] Virtual microphone ready and capturing');
      audioEnabled = true;
      return true;
    }
    return false;
  } catch (error) {
    console.error('[Sokuji] Error starting virtual microphone capture:', error);
    return false;
  }
}

// Override the enumerateDevices method to include our virtual device
navigator.mediaDevices.enumerateDevices = async function() {
  try {
    // Get the original devices
    const devices = await originalEnumerateDevices();
    
    // Check if our virtual device is already in the list
    const virtualDeviceExists = devices.some(device => 
      device.deviceId === VIRTUAL_DEVICE_ID || 
      device.label === VIRTUAL_DEVICE_LABEL
    );
    
    if (!virtualDeviceExists) {
      // Add our virtual microphone to the list
      devices.push({
        deviceId: VIRTUAL_DEVICE_ID,
        kind: 'audioinput',
        label: VIRTUAL_DEVICE_LABEL,
        groupId: VIRTUAL_DEVICE_ID
      });
    }
    
    return devices;
  } catch (error) {
    console.error('[Sokuji] Error in enumerateDevices override:', error);
    return originalEnumerateDevices();
  }
};

// Override getUserMedia to handle requests for our virtual device
navigator.mediaDevices.getUserMedia = async function(constraints) {
  try {
    // If no audio is requested, pass through to the original method
    if (!constraints.audio) {
      return originalGetUserMedia(constraints);
    }
    
    // Check if the request is specifically for our virtual device
    const requestsVirtualMic = constraints.audio === true ||
      (constraints.audio && constraints.audio.deviceId && (
        constraints.audio.deviceId === VIRTUAL_DEVICE_ID ||
        (constraints.audio.deviceId.exact && constraints.audio.deviceId.exact === VIRTUAL_DEVICE_ID) ||
        (Array.isArray(constraints.audio.deviceId.ideal) && constraints.audio.deviceId.ideal.includes(VIRTUAL_DEVICE_ID)) ||
        (Array.isArray(constraints.audio.deviceId.exact) && constraints.audio.deviceId.exact.includes(VIRTUAL_DEVICE_ID))
      ));
    
    // If not requesting our virtual mic, pass through to the original method
    if (!requestsVirtualMic) {
      return originalGetUserMedia(constraints);
    }
    
    console.log('[Sokuji] Virtual microphone requested, initializing...');
    
    // Initialize the WavStreamPlayer if it's not already initialized
    await startCapturing();
    
    // If we don't have a virtual stream, we can't provide it
    if (!virtualMediaStream) {
      console.error('[Sokuji] Virtual media stream not available');
      throw new Error('Virtual microphone is not available');
    }
    
    // Create a new MediaStream with only audio tracks from our virtual stream
    const outputStream = new MediaStream();
    virtualMediaStream.getAudioTracks().forEach(track => {
      outputStream.addTrack(track);
    });
    
    // If video was also requested, get it from the original getUserMedia call
    if (constraints.video) {
      try {
        const videoOnlyConstraints = { video: constraints.video, audio: false };
        const videoStream = await originalGetUserMedia(videoOnlyConstraints);
        
        // Add video tracks to our stream
        videoStream.getVideoTracks().forEach(track => {
          outputStream.addTrack(track);
        });
      } catch (error) {
        console.warn('[Sokuji] Failed to get video tracks:', error);
        // Continue with just audio if video fails
      }
    }
    
    console.log('[Sokuji] Returning virtual microphone stream with', 
      outputStream.getAudioTracks().length, 'audio tracks and',
      outputStream.getVideoTracks().length, 'video tracks');
    
    return outputStream;
  } catch (error) {
    console.error('[Sokuji] Error in getUserMedia override:', error);
    // If the virtual mic fails, try the original method as a fallback
    return originalGetUserMedia(constraints);
  }
};

// Listen for audio chunks from the content script
window.addEventListener('message', (event) => {
  // Only process messages from our own window
  if (event.source !== window) return;
  
  // Check if this is an audio chunk message
  if (event.data && event.data.type === 'AUDIO_CHUNK') {
    const { data } = event.data;
    
    // Process the incoming audio data
    if (data && data.channelData && data.channelData[0]) {
      // Convert Float32Array to Int16Array (scaling from [-1,1] to [-32768,32767])
      const floatSamples = data.channelData[0];
      const int16Samples = new Int16Array(floatSamples.length);
      
      for (let i = 0; i < floatSamples.length; i++) {
        // Scale and clamp to 16-bit range
        const sample = Math.max(-1, Math.min(1, floatSamples[i]));
        int16Samples[i] = Math.round(sample * 32767);
      }
      
      // Add the audio data to our player
      addAudioData(int16Samples, 'content-script');
    }
  }
});

// Initialize the virtual microphone immediately
startCapturing().then(success => {
  if (success) {
    console.log('[Sokuji] Virtual microphone initialized and ready');
  } else {
    console.warn('[Sokuji] Virtual microphone initialization deferred to first use');
  }
});

console.log('[Sokuji] Virtual microphone script loaded');
