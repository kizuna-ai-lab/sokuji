/**
 * AudioWorklet processor for real-time audio recording and conversion to PCM16
 * Replaces the deprecated ScriptProcessor API
 */
class AudioRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // Track processing statistics
    this._processCallCount = 0;
    this._lastLogTime = 0;
    
    // Listen for control messages from the main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'config') {
        // Handle configuration updates if needed
        console.debug('[AudioRecorderProcessor] Received config:', event.data.config);
      }
    };
  }

  /**
   * Process audio input and convert to PCM16
   * @param {Float32Array[][]} inputs - Array of inputs, each with channels
   * @param {Float32Array[][]} outputs - Array of outputs (unused)
   * @param {Object} parameters - Audio parameters (unused)
   * @returns {boolean} - True to keep processor alive
   */
  process(inputs, outputs, parameters) {
    // Get the first input's first channel (mono)
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true; // Keep processor alive even with no input
    }
    
    const inputData = input[0];
    
    // Convert Float32Array to Int16Array (PCM16)
    const pcmData = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      // Clamp to [-1, 1] range and convert to 16-bit integer
      const sample = Math.max(-1, Math.min(1, inputData[i]));
      pcmData[i] = sample < 0 ? sample * 32768 : sample * 32767;
    }
    
    // Log periodically to verify processing (every ~1000 calls)
    this._processCallCount++;
    const now = currentTime;
    if (this._processCallCount % 1000 === 0 || now - this._lastLogTime > 10) {
      console.debug(`[AudioRecorderProcessor] Process call ${this._processCallCount}, buffer length: ${inputData.length}, time: ${now.toFixed(2)}s`);
      this._lastLogTime = now;
    }
    
    // Send PCM data to main thread
    // Transfer the buffer for efficiency
    this.port.postMessage({
      type: 'audioData',
      pcmData: pcmData,
      sampleRate: sampleRate,
      channelCount: 1,
      timestamp: currentTime,
      frameCount: inputData.length
    }, [pcmData.buffer]);
    
    // Return true to keep the processor alive
    return true;
  }
}

// Register the processor
registerProcessor('audio-recorder-processor', AudioRecorderProcessor);