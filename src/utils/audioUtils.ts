/**
 * Audio utilities for enhanced audio processing and feedback prevention
 * 
 * ACOUSTIC ECHO CANCELLATION (AEC) ANALYSIS:
 * 
 * The main issue identified in GitHub issue #55 is that the WavStreamPlayer uses Web Audio API 
 * to write PCM data directly to the audio output buffer. This prevents the browser's built-in 
 * Acoustic Echo Cancellation (AEC) from recognizing the audio as a standard playback stream.
 * 
 * Current limitations:
 * 1. Browser AEC cannot process programmatically generated audio via Web Audio API
 * 2. The feedback loop occurs when microphone captures speaker output
 * 3. No reference signal available for echo cancellation algorithms
 * 
 * Potential software-based AEC solutions (evaluated as complex/low priority):
 * 1. WebAssembly AEC libraries (e.g., libspeex, WebRTC's AEC implementation)
 * 2. Real-time audio processing with correlation-based echo detection
 * 3. Adaptive filtering using LMS/NLMS algorithms
 * 
 * Recommended solution: Headphone usage (implemented via UI notifications)
 * - Most reliable and immediate solution
 * - No performance impact
 * - Addresses root cause of feedback loop
 */

/**
 * Enhanced audio constraints for better recording quality and feedback prevention
 */
export const getEnhancedAudioConstraints = (deviceId?: string): MediaStreamConstraints => {
  return {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      sampleRate: 24000,
      // Enhanced echo cancellation and noise suppression
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      // Additional constraints for better audio quality
      channelCount: 1,
      latency: 0.02, // 20ms latency for real-time processing
      // Advanced audio processing settings
      suppressLocalAudioPlayback: true, // Prevent local audio playback feedback
      googEchoCancellation: true, // Google-specific echo cancellation
      googAutoGainControl: true, // Google-specific auto gain control
      googNoiseSuppression: true, // Google-specific noise suppression
      googHighpassFilter: true, // High-pass filter to remove low-frequency noise
      googTypingNoiseDetection: true, // Typing noise detection and suppression
      googAudioMirroring: false, // Disable audio mirroring to prevent feedback
    } as any // Type assertion for advanced constraints
  };
};

/**
 * Check if current setup is using speaker mode (WavStreamPlayer output to speakers)
 */
export const isSpeakerMode = (
  outputDevice: { deviceId: string; label: string } | null
): boolean => {
  if (!outputDevice) {
    return false;
  }

  const outputLabel = outputDevice.label.toLowerCase();
  
  // Speaker mode detection: output device that's NOT headphones/earphones
  const isHeadphones = outputLabel.includes('headphone') || 
                      outputLabel.includes('earphone') || 
                      outputLabel.includes('earbud') ||
                      outputLabel.includes('headset');
  
  return !isHeadphones;
};

/**
 * Check if two audio devices are likely to cause feedback
 */
export const isLikelyToGenerateFeedback = (
  inputDevice: { deviceId: string; label: string } | null,
  outputDevice: { deviceId: string; label: string } | null
): boolean => {
  if (!inputDevice || !outputDevice) {
    return false;
  }

  const inputLabel = inputDevice.label.toLowerCase();
  const outputLabel = outputDevice.label.toLowerCase();

  // Check for same device
  if (inputDevice.deviceId === outputDevice.deviceId) {
    return true;
  }

  // Check for same device by name
  if (inputLabel === outputLabel) {
    return true;
  }

  // Check for default devices (likely to be the same physical device)
  if (inputLabel.includes('default') && outputLabel.includes('default')) {
    return true;
  }

  // Check for virtual devices (which might cause feedback loops)
  if (outputLabel.includes('sokuji') || outputLabel.includes('virtual') || 
      inputLabel.includes('sokuji') || inputLabel.includes('virtual')) {
    return true;
  }

  // Speaker mode with microphone always has high feedback risk
  if (isSpeakerMode(outputDevice)) {
    return true;
  }

  // Check for same device family (e.g., both are from the same manufacturer/product)
  const extractDeviceFamily = (label: string): string => {
    // Remove common prefixes and suffixes
    return label
      .replace(/^(default\s-\s)?/, '')
      .replace(/\s\((.*)\)$/, '')
      .replace(/\s-\s.*$/, '')
      .toLowerCase();
  };

  const inputFamily = extractDeviceFamily(inputLabel);
  const outputFamily = extractDeviceFamily(outputLabel);

  if (inputFamily === outputFamily && inputFamily.length > 0) {
    return true;
  }

  return false;
};

/**
 * Get safe audio device configuration to prevent feedback
 */
export const getSafeAudioConfiguration = (
  inputDevice: { deviceId: string; label: string } | null,
  outputDevice: { deviceId: string; label: string } | null,
  isPassthroughEnabled: boolean
): {
  safePassthroughEnabled: boolean;
  recommendedAction?: string;
  feedbackRisk: 'low' | 'medium' | 'high';
} => {
  if (!isPassthroughEnabled) {
    return { 
      safePassthroughEnabled: false,
      feedbackRisk: 'low'
    };
  }

  if (!inputDevice || !outputDevice) {
    return { 
      safePassthroughEnabled: false,
      feedbackRisk: 'low'
    };
  }

  const isSpeaker = isSpeakerMode(outputDevice);
  const isLikelyFeedback = isLikelyToGenerateFeedback(inputDevice, outputDevice);

  // High risk: Speaker mode or clear feedback indicators
  if (isSpeaker) {
    return {
      safePassthroughEnabled: false,
      recommendedAction: 'For speaker mode, strongly recommend using headphones to prevent echo/feedback loops that can interfere with translation accuracy',
      feedbackRisk: 'high'
    };
  }

  // Medium/High risk: Other feedback indicators
  if (isLikelyFeedback) {
    return {
      safePassthroughEnabled: false,
      recommendedAction: 'Please select different input and output devices to enable real voice passthrough',
      feedbackRisk: 'medium'
    };
  }

  // Low risk: Safe configuration
  return { 
    safePassthroughEnabled: true,
    feedbackRisk: 'low'
  };
};

/**
 * Apply audio processing to reduce feedback and improve quality
 */
export const applyAudioProcessing = (
  audioContext: AudioContext,
  sourceNode: MediaStreamAudioSourceNode
): {
  processedNode: AudioNode;
  cleanup: () => void;
} => {
  const nodes: AudioNode[] = [];

  try {
    // Create a high-pass filter to remove low-frequency noise
    const highPassFilter = audioContext.createBiquadFilter();
    highPassFilter.type = 'highpass';
    highPassFilter.frequency.value = 85; // Remove frequencies below 85Hz
    highPassFilter.Q.value = 0.7;
    nodes.push(highPassFilter);

    // Create a low-pass filter to remove high-frequency noise
    const lowPassFilter = audioContext.createBiquadFilter();
    lowPassFilter.type = 'lowpass';
    lowPassFilter.frequency.value = 8000; // Remove frequencies above 8kHz
    lowPassFilter.Q.value = 0.7;
    nodes.push(lowPassFilter);

    // Create a compressor to normalize audio levels
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -24; // dB
    compressor.knee.value = 30; // dB
    compressor.ratio.value = 12; // 12:1 ratio
    compressor.attack.value = 0.003; // 3ms attack
    compressor.release.value = 0.25; // 250ms release
    nodes.push(compressor);

    // Create a gain node for volume control
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.8; // Slightly reduce gain to prevent clipping
    nodes.push(gainNode);

    // Connect the nodes in sequence
    let currentNode: AudioNode = sourceNode;
    for (const node of nodes) {
      currentNode.connect(node);
      currentNode = node;
    }

    const cleanup = () => {
      try {
        for (const node of nodes) {
          node.disconnect();
        }
      } catch (error) {
        console.warn('[Sokuji] [AudioUtils] Error during audio processing cleanup:', error);
      }
    };

    return {
      processedNode: currentNode,
      cleanup
    };
  } catch (error) {
    console.error('[Sokuji] [AudioUtils] Error applying audio processing:', error);
    
    // Return the original source node if processing fails
    return {
      processedNode: sourceNode,
      cleanup: () => {}
    };
  }
};

/**
 * Create an advanced echo cancellation setup
 */
export const createEchoCancellationSetup = (
  audioContext: AudioContext,
  inputStream: MediaStream
): {
  processedStream: MediaStream;
  cleanup: () => void;
} => {
  try {
    // Create a media stream destination for the processed audio
    const destination = audioContext.createMediaStreamDestination();
    
    // Create source from input stream
    const source = audioContext.createMediaStreamSource(inputStream);
    
    // Apply audio processing
    const { processedNode, cleanup: processingCleanup } = applyAudioProcessing(audioContext, source);
    
    // Connect processed audio to destination
    processedNode.connect(destination);
    
    const cleanup = () => {
      try {
        processingCleanup();
        source.disconnect();
        destination.disconnect();
      } catch (error) {
        console.warn('[Sokuji] [AudioUtils] Error during echo cancellation cleanup:', error);
      }
    };

    return {
      processedStream: destination.stream,
      cleanup
    };
  } catch (error) {
    console.error('[Sokuji] [AudioUtils] Error creating echo cancellation setup:', error);
    
    // Return the original stream if processing fails
    return {
      processedStream: inputStream,
      cleanup: () => {}
    };
  }
};

/**
 * Analyze audio for potential feedback issues
 */
export const analyzeAudioForFeedback = (
  audioContext: AudioContext,
  inputNode: AudioNode,
  callback: (feedbackDetected: boolean, level: number) => void
): () => void => {
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;
  
  inputNode.connect(analyser);
  
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  let lastAnalysisTime = 0;
  const analysisInterval = 100; // Analyze every 100ms
  
  const analyze = () => {
    const now = Date.now();
    if (now - lastAnalysisTime < analysisInterval) {
      requestAnimationFrame(analyze);
      return;
    }
    
    lastAnalysisTime = now;
    
    analyser.getByteFrequencyData(dataArray);
    
    // Look for suspicious patterns that might indicate feedback
    let highFrequencyActivity = 0;
    let overallLevel = 0;
    
    for (let i = 0; i < bufferLength; i++) {
      const value = dataArray[i];
      overallLevel += value;
      
      // Check for high-frequency content that might indicate feedback
      if (i > bufferLength * 0.7) { // Upper 30% of frequency range
        highFrequencyActivity += value;
      }
    }
    
    const averageLevel = overallLevel / bufferLength;
    const highFrequencyRatio = highFrequencyActivity / (bufferLength * 0.3);
    
    // Simple heuristic: if high-frequency activity is disproportionately high
    // and overall level is significant, it might be feedback
    const feedbackDetected = highFrequencyRatio > 100 && averageLevel > 50;
    
    callback(feedbackDetected, averageLevel);
    
    requestAnimationFrame(analyze);
  };
  
  requestAnimationFrame(analyze);
  
  return () => {
    try {
      analyser.disconnect();
    } catch (error) {
      console.warn('[Sokuji] [AudioUtils] Error cleaning up feedback analyzer:', error);
    }
  };
};

/**
 * Decode PCM16 audio data to WAV format with blob, url, values and audioBuffer
 * Replacement for WavRecorder.decode() to remove wavtools dependency
 */
export const decodeAudioToWav = async (
  audioData: Int16Array,
  sampleRate: number = 24000,
  fromSampleRate: number = 24000
): Promise<{
  blob: Blob;
  url: string;
  values: Float32Array;
  audioBuffer: AudioBuffer;
}> => {
  // Create WAV header
  const createWavHeader = (dataSize: number): Uint8Array => {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = fromSampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    
    // RIFF header
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, dataSize + 36, true); // file size - 8
    view.setUint32(8, 0x57415645, false); // "WAVE"
    
    // fmt chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, fromSampleRate, true); // Use fromSampleRate for the WAV header
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    
    // data chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataSize, true);
    
    return new Uint8Array(header);
  };

  // Create WAV blob from PCM data
  const arrayBuffer = audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength);
  const wavHeader = createWavHeader(arrayBuffer.byteLength);
  const wavArray = new Uint8Array(44 + arrayBuffer.byteLength);
  
  wavArray.set(wavHeader, 0);
  wavArray.set(new Uint8Array(arrayBuffer), 44);
  
  const blob = new Blob([wavArray], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);

  // Create audio context and decode the audio data
  const audioContext = new AudioContext({ sampleRate });
  // Convert blob to ArrayBuffer for decodeAudioData
  const wavArrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(wavArrayBuffer);
  const values = audioBuffer.getChannelData(0);
  
  // Close the audio context to free resources
  await audioContext.close();

  return {
    blob,
    url,
    values,
    audioBuffer
  };
}; 