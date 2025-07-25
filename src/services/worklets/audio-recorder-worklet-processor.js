/**
 * AudioWorklet processor for real-time audio recording and conversion to PCM16
 * Replaces the deprecated ScriptProcessor API
 * Enhanced with internal buffering and startup frame skipping for stability
 */
class AudioRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // Track processing statistics
    this._processCallCount = 0;
    this._lastLogTime = 0;
    
    // Recording state
    this._isRecording = true; // Start in recording mode for passthrough support
    this._startupFrameCount = 0;
    this._skipStartupFrames = 5; // Default: skip first 5 frames
    
    // Internal buffering for smoother output
    this._internalBuffer = [];
    this._bufferSize = 512; // Send data in chunks of 512 samples
    
    // Listen for control messages from the main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'config') {
        // Handle configuration updates
        const config = event.data.config;
        if (config.skipStartupFrames !== undefined) {
          this._skipStartupFrames = config.skipStartupFrames;
        }
        console.debug('[AudioRecorderProcessor] Received config:', config);
      } else if (event.data.type === 'start') {
        this._isRecording = true;
        this._startupFrameCount = 0;
        console.debug('[AudioRecorderProcessor] Recording started');
      } else if (event.data.type === 'stop') {
        this._isRecording = false;
        // Flush any remaining buffered data
        this._flushBuffer();
        console.debug('[AudioRecorderProcessor] Recording stopped');
      }
    };
  }

  /**
   * Flush any remaining data in the internal buffer
   */
  _flushBuffer() {
    if (this._internalBuffer.length > 0) {
      const pcmData = new Int16Array(this._internalBuffer);
      this._internalBuffer = [];
      
      this.port.postMessage({
        type: 'audioData',
        pcmData: pcmData,
        sampleRate: sampleRate,
        channelCount: 1,
        timestamp: currentTime,
        frameCount: pcmData.length
      }, [pcmData.buffer]);
    }
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
    
    // Only process if recording is active
    if (!this._isRecording) {
      return true;
    }
    
    // Skip initial frames to avoid startup instability
    if (this._startupFrameCount < this._skipStartupFrames) {
      this._startupFrameCount++;
      if (this._startupFrameCount === this._skipStartupFrames) {
        console.debug(`[AudioRecorderProcessor] Skipped ${this._skipStartupFrames} startup frames`);
      }
      return true;
    }
    
    const inputData = input[0];
    
    // Convert Float32Array to Int16Array (PCM16) and add to buffer
    for (let i = 0; i < inputData.length; i++) {
      // Clamp to [-1, 1] range and convert to 16-bit integer
      const sample = Math.max(-1, Math.min(1, inputData[i]));
      const pcmSample = sample < 0 ? sample * 32768 : sample * 32767;
      this._internalBuffer.push(pcmSample);
    }
    
    // Send buffered data when buffer size is reached
    if (this._internalBuffer.length >= this._bufferSize) {
      const pcmData = new Int16Array(this._internalBuffer.slice(0, this._bufferSize));
      this._internalBuffer = this._internalBuffer.slice(this._bufferSize);
      
      // Log periodically to verify processing
      this._processCallCount++;
      const now = currentTime;
      if (this._processCallCount % 100 === 0 || now - this._lastLogTime > 10) {
        console.debug(`[AudioRecorderProcessor] Sent buffer ${this._processCallCount}, size: ${pcmData.length}, time: ${now.toFixed(2)}s`);
        this._lastLogTime = now;
      }
      
      // Send PCM data to main thread
      this.port.postMessage({
        type: 'audioData',
        pcmData: pcmData,
        sampleRate: sampleRate,
        channelCount: 1,
        timestamp: currentTime,
        frameCount: pcmData.length
      }, [pcmData.buffer]);
    }
    
    // Return true to keep the processor alive
    return true;
  }
}

// Register the processor
registerProcessor('audio-recorder-processor', AudioRecorderProcessor);