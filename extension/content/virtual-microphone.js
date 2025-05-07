// Virtual Microphone implementation
// This script overrides enumerateDevices and getUserMedia to create a virtual microphone
// that can be used to inject audio into web applications

// Configuration
const VIRTUAL_DEVICE_ID = 'sokuji-virtual-microphone';
const VIRTUAL_DEVICE_LABEL = 'Sokuji_Virtual_Mic';

// Store original methods
const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

// Audio processing variables
let audioContext = null;
let virtualStream = null;
let destinationNode = null;
let isCapturing = false;

// Initialize audio context and nodes
function initAudioContext() {
  if (audioContext) return;
  
  try {
    audioContext = new AudioContext();
    destinationNode = audioContext.createMediaStreamDestination();
    
    // Create a silent audio stream for the virtual microphone
    const oscillator = audioContext.createOscillator();
    oscillator.frequency.value = 0; // Silent
    oscillator.connect(destinationNode);
    oscillator.start();
    
    virtualStream = destinationNode.stream;
    console.log('[Sokuji] Virtual microphone audio context initialized');
  } catch (error) {
    console.error('[Sokuji] Failed to initialize audio context:', error);
  }
}

// Setup API for receiving audio data from external sources
function setupAudioAPI() {
  // Create a global function that can be called to inject audio data
  window.sokujiInjectAudio = (audioData) => {
    if (!audioData || !audioContext) {
      console.error('[Sokuji] Cannot inject audio: invalid data or audio context not ready');
      return false;
    }
    
    try {
      // Create a new audio buffer
      const buffer = audioContext.createBuffer(
        audioData.numberOfChannels,
        audioData.numberOfChannels * audioData.duration * audioData.sampleRate,
        audioData.sampleRate
      );
      
      // Fill the buffer with the received audio data
      for (let channel = 0; channel < audioData.numberOfChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        // Copy the data from the received array
        for (let i = 0; i < audioData.channelData[channel].length; i++) {
          channelData[i] = audioData.channelData[channel][i];
        }
      }
      
      // Create and play the buffer
      const bufferSource = audioContext.createBufferSource();
      bufferSource.buffer = buffer;
      bufferSource.connect(destinationNode);
      bufferSource.start();
      
      console.log('[Sokuji] Processed injected audio data');
      return true;
    } catch (error) {
      console.error('[Sokuji] Error processing audio data:', error);
      return false;
    }
  };
  
  console.log('[Sokuji] Audio injection API set up');
}

// Start capturing audio
function startCapturing() {
  if (isCapturing) return;
  
  initAudioContext();
  setupAudioAPI();
  
  isCapturing = true;
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
  // If audio is requested and our virtual device is specified
  if (constraints && constraints.audio) {
    if (
      (typeof constraints.audio === 'object' && 
       constraints.audio.deviceId && 
       (constraints.audio.deviceId.exact === VIRTUAL_DEVICE_ID || 
        (Array.isArray(constraints.audio.deviceId.ideal) && 
         constraints.audio.deviceId.ideal.includes(VIRTUAL_DEVICE_ID)) ||
        constraints.audio.deviceId === VIRTUAL_DEVICE_ID)) ||
      (constraints.audio === true)
    ) {
      console.log('[Sokuji] Virtual microphone requested');
      
      // Initialize our virtual microphone if not already done
      startCapturing();
      
      if (virtualStream) {
        // If we have video constraints, get the video stream separately
        // and combine with our virtual audio stream
        if (constraints.video) {
          const videoConstraints = { video: constraints.video, audio: false };
          try {
            const videoStream = await originalGetUserMedia(videoConstraints);
            
            // Combine video tracks with our virtual audio track
            const combinedStream = new MediaStream();
            videoStream.getVideoTracks().forEach(track => combinedStream.addTrack(track));
            virtualStream.getAudioTracks().forEach(track => combinedStream.addTrack(track));
            
            return combinedStream;
          } catch (error) {
            console.error('[Sokuji] Failed to get video stream:', error);
            // Fall back to just audio if video fails
            return virtualStream;
          }
        }
        
        return virtualStream;
      }
    }
  }
  
  // For all other requests, use the original implementation
  return originalGetUserMedia(constraints);
};

// Initialize everything
startCapturing();

// Expose API for debugging
window.sokujiVirtualMic = {
  startCapturing,
  getStatus: () => ({ isCapturing, hasAudioContext: !!audioContext, hasVirtualStream: !!virtualStream })
};

console.log('[Sokuji] Virtual microphone script loaded');
