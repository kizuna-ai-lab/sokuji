/**
 * Modern Audio Recorder using standard browser APIs
 * Replaces WavRecorder with MediaRecorder API for better echo cancellation support
 * Updated: Fixed audio processing and connection state issues
 * @class
 */
export class ModernAudioRecorder {
  /**
   * Create a new ModernAudioRecorder instance
   * @param {{sampleRate?: number, enablePassthrough?: boolean, debug?: boolean}} [options]
   * @returns {ModernAudioRecorder}
   */
  constructor({
    sampleRate = 24000,
    enablePassthrough = true,
    debug = false,
  } = {}) {
    // Config
    this.sampleRate = sampleRate;
    this.enablePassthrough = enablePassthrough;
    this.debug = !!debug;
    this._deviceChangeCallback = null;
    this._devices = [];
    
    // State variables
    this.stream = null;
    this.mediaRecorder = null;
    this.recording = false;
    this.audioContext = null;
    this.mediaStreamSource = null;
    this.scriptProcessor = null;
    this.analyser = null;
    this.dummyGain = null;
    
    // Passthrough settings
    this._passthroughPlayer = null;
    this._passthroughEnabled = false;
    this._passthroughVolume = 0.2;
    this._passthroughShouldPlay = true;
    
    // Audio processing
    this.onAudioData = null;
    this.audioChunks = [];
    this.isProcessing = false;
    this._audioChunkCount = 0;
  }

  /**
   * Sets up passthrough to a ModernAudioPlayer
   * @param {import('./ModernAudioPlayer.js').ModernAudioPlayer} player The player instance to receive audio
   * @param {boolean} enabled Whether passthrough is enabled
   * @param {number} volume Volume level (0.0 to 1.0)
   * @param {boolean} shouldPlay Whether to actually play the passthrough audio
   * @returns {true}
   */
  setupPassthrough(player, enabled = false, volume = 0.2, shouldPlay = true) {
    this._passthroughPlayer = player;
    this._passthroughEnabled = enabled;
    this._passthroughVolume = Math.max(0, Math.min(1, volume));
    this._passthroughShouldPlay = shouldPlay;
    this.log(`Passthrough setup: enabled=${enabled}, volume=${this._passthroughVolume}, shouldPlay=${shouldPlay}`);
    return true;
  }

  /**
   * Enables or disables passthrough
   * @param {boolean} enabled
   * @returns {true}
   */
  setPassthroughEnabled(enabled) {
    this._passthroughEnabled = enabled;
    this.log(`Passthrough ${enabled ? 'enabled' : 'disabled'}`);
    return true;
  }

  /**
   * Sets the volume for passthrough
   * @param {number} volume Volume level (0.0 to 1.0)
   * @returns {true}
   */
  setPassthroughVolume(volume) {
    this._passthroughVolume = Math.max(0, Math.min(1, volume));
    this.log(`Passthrough volume set to: ${this._passthroughVolume}`);
    return true;
  }

  /**
   * Sets whether passthrough should actually play audio
   * @param {boolean} shouldPlay Whether to play passthrough audio
   * @returns {true}
   */
  setPassthroughShouldPlay(shouldPlay) {
    this._passthroughShouldPlay = shouldPlay;
    this.log(`Passthrough shouldPlay set to: ${this._passthroughShouldPlay}`);
    return true;
  }

  /**
   * Logs data in debug mode
   * @param {...any} arguments
   * @returns {true}
   */
  log() {
    if (this.debug) {
      console.log('[Sokuji] [ModernAudioRecorder]', ...arguments);
    }
    return true;
  }

  /**
   * Retrieves the current sampleRate for the recorder
   * @returns {number}
   */
  getSampleRate() {
    return this.sampleRate;
  }

  /**
   * Retrieves the current status of the recording
   * @returns {"ended"|"paused"|"recording"}
   */
  getStatus() {
    if (!this.mediaRecorder) {
      return 'ended';
    } else if (!this.recording) {
      return 'paused';
    } else {
      return 'recording';
    }
  }

  /**
   * Sets device change callback, remove if callback provided is `null`
   * @param {(Array<MediaDeviceInfo & {default: boolean}>): void|null} callback
   * @returns {true}
   */
  listenForDeviceChange(callback) {
    if (callback === null && this._deviceChangeCallback) {
      navigator.mediaDevices.removeEventListener(
        'devicechange',
        this._deviceChangeCallback,
      );
      this._deviceChangeCallback = null;
    } else if (callback !== null) {
      let lastId = 0;
      let lastDevices = [];
      const serializeDevices = (devices) =>
        devices
          .map((d) => d.deviceId)
          .sort()
          .join(',');
      const cb = async () => {
        let id = ++lastId;
        const devices = await this.listDevices();
        if (id === lastId) {
          if (serializeDevices(lastDevices) !== serializeDevices(devices)) {
            lastDevices = devices;
            callback(devices.slice());
          }
        }
      };
      navigator.mediaDevices.addEventListener('devicechange', cb);
      cb();
      this._deviceChangeCallback = cb;
    }
    return true;
  }

  /**
   * Manually request permission to use the microphone
   * @returns {Promise<true>}
   */
  async requestPermission() {
    const permissionStatus = await navigator.permissions.query({
      name: 'microphone',
    });
    if (permissionStatus.state === 'denied') {
      window.alert('You must grant microphone access to use this feature.');
    } else if (permissionStatus.state === 'prompt') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        const tracks = stream.getTracks();
        tracks.forEach((track) => track.stop());
      } catch (e) {
        window.alert('You must grant microphone access to use this feature.');
      }
    }
    return true;
  }

  /**
   * List all eligible devices for recording
   * @returns {Promise<Array<MediaDeviceInfo & {default: boolean}>>}
   */
  async listDevices() {
    if (
      !navigator.mediaDevices ||
      !('enumerateDevices' in navigator.mediaDevices)
    ) {
      throw new Error('Could not request user devices');
    }
    await this.requestPermission();
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioDevices = devices.filter(
      (device) => device.kind === 'audioinput',
    );
    const defaultDeviceIndex = audioDevices.findIndex(
      (device) => device.deviceId === 'default',
    );
    const deviceList = [];
    if (defaultDeviceIndex !== -1) {
      let defaultDevice = audioDevices.splice(defaultDeviceIndex, 1)[0];
      let existingIndex = audioDevices.findIndex(
        (device) => device.groupId === defaultDevice.groupId,
      );
      if (existingIndex !== -1) {
        defaultDevice = audioDevices.splice(existingIndex, 1)[0];
      }
      defaultDevice.default = true;
      deviceList.push(defaultDevice);
    }
    return deviceList.concat(audioDevices);
  }

  /**
   * Get supported MIME type for MediaRecorder
   * @private
   * @returns {string}
   */
  getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/wav'
    ];
    
    return types.find(type => MediaRecorder.isTypeSupported(type)) || 'audio/webm';
  }

  /**
   * Request microphone permissions and begin recording
   * @param {string} [deviceId] - Optional device ID to use for recording
   * @returns {Promise<boolean>}
   */
  async begin(deviceId) {
    if (this.mediaRecorder) {
      throw new Error(
        `ModernAudioRecorder: Already connected: please call .end() to start over`,
      );
    }

    // Modern getUserMedia constraints with best practices for echo cancellation
    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        sampleRate: this.sampleRate,
        
        // 2024-2025 best practices for echo cancellation
        echoCancellation: true,
        echoCancellationType: 'system', // Chrome M68+ prefer system-level AEC
        noiseSuppression: true,
        autoGainControl: true,
        suppressLocalAudioPlayback: true, // Now effective!
        
        // Advanced audio processing
        googEchoCancellation: true,
        googNoiseSuppression: true,
        googAutoGainControl: true,
        googHighpassFilter: true,
        googTypingNoiseDetection: true,
        googAudioMirroring: false,
        
        // Performance optimization
        channelCount: 1,
        latency: 0.02 // 20ms low latency
      }
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.log('Got stream, setting up recording');
      
      // Verify echo cancellation configuration
      const track = this.stream.getAudioTracks()[0];
      const settings = track.getSettings();
      this.log('Echo cancellation:', settings.echoCancellation);
      this.log('Echo cancellation type:', settings.echoCancellationType);
      this.log('Suppress local audio playback:', settings.suppressLocalAudioPlayback);
      
    } catch (err) {
      console.error('[Sokuji] [ModernAudioRecorder] Could not start audio recording', err);
      return false;
    }

    // Create AudioContext for audio analysis and real-time processing
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // Set up real-time audio processing for AI input and passthrough
    await this.setupRealtimeAudioProcessing();

    // Setup MediaRecorder with optimal settings (for recording only)
    const mimeType = this.getSupportedMimeType();
    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType,
      audioBitsPerSecond: 128000 // High quality audio
    });

    this.setupMediaRecorderEvents();
    return true;
  }

  /**
   * Setup real-time audio processing for AI input and passthrough
   * @private
   */
  async setupRealtimeAudioProcessing() {
    if (!this.audioContext || !this.stream) {
      throw new Error('AudioContext and stream required for real-time processing');
    }

    // Create MediaStreamSource
    this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.stream);
    
    // Create ScriptProcessor for real-time audio processing
    // Note: ScriptProcessor is deprecated but still widely supported
    // For production, consider migrating to AudioWorklet
    const bufferSize = 4096; // Good balance between latency and performance
    this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
    
    this.scriptProcessor.onaudioprocess = (event) => {
      const inputBuffer = event.inputBuffer;
      const inputData = inputBuffer.getChannelData(0);
      
      // Debug: Log every 200 calls to verify ScriptProcessor is working
      this._scriptProcessorCallCount = (this._scriptProcessorCallCount || 0) + 1;
      if (this._scriptProcessorCallCount % 200 === 0) {
        this.log(`ScriptProcessor callback triggered: call ${this._scriptProcessorCallCount}, buffer length: ${inputData.length}`);
      }
      
      // Convert to PCM16 for AI processing
      const pcmData = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const sample = Math.max(-1, Math.min(1, inputData[i]));
        pcmData[i] = sample < 0 ? sample * 32768 : sample * 32767;
      }
      
      // Handle passthrough (safe method)
      if (this._passthroughEnabled && this._passthroughPlayer && pcmData.length > 0) {
        this._passthroughPlayer.addToPassthroughBuffer(pcmData, this._passthroughVolume, this._passthroughShouldPlay);
      }
      
      // Send to AI processing if recording is active and callback is set
      if (this.recording && this.onAudioData && typeof this.onAudioData === 'function' && pcmData.length > 0) {
        try {
          // Add debug logging every 100 chunks to verify data flow
          if (this._audioChunkCount % 100 === 0) {
            this.log(`Sending audio chunk ${this._audioChunkCount}, PCM length: ${pcmData.length}, sample range: ${Math.min(...pcmData)} to ${Math.max(...pcmData)}`);
          }
          this._audioChunkCount = (this._audioChunkCount || 0) + 1;
          
          this.onAudioData({ 
            mono: pcmData, 
            raw: pcmData 
          });
        } catch (error) {
          console.error('[Sokuji] [ModernAudioRecorder] Error in onAudioData callback:', error);
        }
      }
    };
    
    // Connect the nodes 
    this.mediaStreamSource.connect(this.scriptProcessor);
    
    // Create a dummy gain node with zero volume to keep ScriptProcessor active
    // without causing audio feedback
    this.dummyGain = this.audioContext.createGain();
    this.dummyGain.gain.value = 0; // Mute the output
    this.scriptProcessor.connect(this.dummyGain);
    this.dummyGain.connect(this.audioContext.destination);
    
    this.log('Real-time audio processing setup complete');
  }

  /**
   * Setup MediaRecorder event handlers
   * @private
   */
  setupMediaRecorderEvents() {
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
        this.processAudioChunk(event.data);
      }
    };

    this.mediaRecorder.onstart = () => {
      this.log('MediaRecorder started');
    };

    this.mediaRecorder.onstop = () => {
      this.log('MediaRecorder stopped');
    };

    this.mediaRecorder.onerror = (event) => {
      console.error('[Sokuji] [ModernAudioRecorder] MediaRecorder error:', event.error);
    };
  }

  /**
   * Process audio chunk from MediaRecorder
   * @private
   * @param {Blob} blob
   */
  async processAudioChunk(blob) {
    // Skip processing MediaRecorder chunks for real-time audio
    // MediaRecorder chunks are compressed and not suitable for real-time PCM processing
    // Real-time audio processing is handled by the audio analysis node instead
    this.log('MediaRecorder chunk received, size:', blob.size);
  }

  /**
   * Decode audio data to AudioBuffer
   * @private
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<AudioBuffer>}
   */
  async decodeAudioData(arrayBuffer) {
    if (!this.audioContext) {
      throw new Error('AudioContext not available');
    }
    return await this.audioContext.decodeAudioData(arrayBuffer);
  }

  /**
   * Convert AudioBuffer to PCM16 Int16Array
   * @private
   * @param {AudioBuffer} audioBuffer
   * @returns {Int16Array}
   */
  audioBufferToPCM16(audioBuffer) {
    const channelData = audioBuffer.getChannelData(0); // Use first channel (mono)
    const pcmData = new Int16Array(channelData.length);
    
    for (let i = 0; i < channelData.length; i++) {
      // Convert from float32 (-1 to 1) to int16 (-32768 to 32767)
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      pcmData[i] = sample < 0 ? sample * 32768 : sample * 32767;
    }
    
    return pcmData;
  }

  /**
   * Start recording and storing to memory
   * @param {(data: { mono: Int16Array; raw: Int16Array }) => any} [chunkProcessor]
   * @param {number} [chunkSize] Recording interval in milliseconds
   * @returns {Promise<true>}
   */
  async record(chunkProcessor = () => {}, chunkSize = 100) {
    if (!this.mediaRecorder) {
      throw new Error('Session ended: please call .begin() first');
    } else if (this.recording) {
      throw new Error('Already recording: please call .pause() first');
    } else if (typeof chunkProcessor !== 'function') {
      throw new Error(`chunkProcessor must be a function`);
    }

    this.onAudioData = chunkProcessor;
    this.audioChunks = [];
    
    this.log('Recording ...');
    
    // Start MediaRecorder with specified interval
    this.mediaRecorder.start(chunkSize);
    this.recording = true;
    
    return true;
  }

  /**
   * Pause the recording
   * @returns {Promise<true>}
   */
  async pause() {
    if (!this.mediaRecorder) {
      throw new Error('Session ended: please call .begin() first');
    } else if (!this.recording) {
      throw new Error('Already paused: please call .record() first');
    }

    this.log('Pausing ...');
    
    if (this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
      
      // Restart for next recording session
      setTimeout(() => {
        if (this.mediaRecorder && this.mediaRecorder.state === 'inactive') {
          this.setupMediaRecorderEvents();
        }
      }, 100);
    }
    
    this.recording = false;
    return true;
  }

  /**
   * Clear audio buffer
   * @returns {Promise<true>}
   */
  async clear() {
    if (!this.mediaRecorder) {
      throw new Error('Session ended: please call .begin() first');
    }
    
    this.audioChunks = [];
    this.log('Audio buffer cleared');
    return true;
  }

  /**
   * Read current audio data (not implemented in MediaRecorder version)
   * @returns {Promise<{meanValues: Float32Array, channels: Array<Float32Array>}>}
   */
  async read() {
    this.log('Read operation not supported in MediaRecorder mode');
    return {
      meanValues: new Float32Array(0),
      channels: []
    };
  }

  /**
   * Save current recording as WAV file
   * @param {boolean} [force] Force saving while recording
   * @returns {Promise<{blob: Blob, url: string}>}
   */
  async save(force = false) {
    if (!this.mediaRecorder) {
      throw new Error('Session ended: please call .begin() first');
    }
    
    if (!force && this.recording) {
      throw new Error(
        'Currently recording: please call .pause() first, or call .save(true) to force',
      );
    }

    this.log('Saving recording...');
    
    if (this.audioChunks.length === 0) {
      throw new Error('No audio data to save');
    }

    // Create blob from chunks
    const mimeType = this.getSupportedMimeType();
    const blob = new Blob(this.audioChunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    return { blob, url };
  }

  /**
   * End recording session and save result
   * @returns {Promise<{blob: Blob, url: string}>}
   */
  async end() {
    if (!this.mediaRecorder) {
      throw new Error('Session ended: please call .begin() first');
    }

    this.log('Stopping ...');
    
    // Stop recording if active
    if (this.recording) {
      await this.pause();
    }

    // Save audio data before cleanup (if any chunks exist)
    let savedAudio = null;
    try {
      if (this.audioChunks.length > 0) {
        savedAudio = await this.save(true);
      }
    } catch (saveError) {
      this.log('No audio data to save or save failed:', saveError.message);
      // Create empty response for compatibility
      savedAudio = { blob: new Blob([], { type: 'audio/webm' }), url: '' };
    }

    // Stop all tracks
    if (this.stream) {
      const tracks = this.stream.getTracks();
      tracks.forEach((track) => track.stop());
      this.stream = null;
    }

    // Clean up real-time audio processing
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    
    if (this.dummyGain) {
      this.dummyGain.disconnect();
      this.dummyGain = null;
    }
    
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    
    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }

    // Clean up MediaRecorder
    this.mediaRecorder = null;
    this.recording = false;

    // Clean up AudioContext
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close();
      this.audioContext = null;
    }

    // Return saved audio or empty response
    return savedAudio || { blob: new Blob([], { type: 'audio/webm' }), url: '' };
  }

  /**
   * Perform cleanup
   * @returns {Promise<true>}
   */
  async quit() {
    this.listenForDeviceChange(null);
    if (this.mediaRecorder) {
      await this.end();
    }
    return true;
  }

  /**
   * Get frequency analysis for real-time visualization
   * @param {"frequency"|"music"|"voice"} [analysisType]
   * @param {number} [minDecibels]
   * @param {number} [maxDecibels]
   * @returns {{values: Float32Array, peaks: Array}}
   */
  getFrequencies(analysisType = 'frequency', minDecibels = -100, maxDecibels = -30) {
    if (!this.audioContext || !this.mediaStreamSource || !this.recording) {
      return {
        values: new Float32Array(1024),
        peaks: []
      };
    }

    // Create analyser if it doesn't exist
    if (!this.analyser) {
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.minDecibels = minDecibels;
      this.analyser.maxDecibels = maxDecibels;
      
      // Connect to the existing audio stream
      if (this.mediaStreamSource) {
        this.mediaStreamSource.connect(this.analyser);
      }
    }

    // Get frequency data
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);
    
    // Convert to Float32Array and apply analysis type filtering
    const result = new Float32Array(bufferLength);
    for (let i = 0; i < bufferLength; i++) {
      result[i] = dataArray[i] / 255.0; // Normalize to 0-1
    }
    
    // Apply frequency range filtering based on analysis type
    let filteredResult = result;
    if (analysisType === 'voice') {
      // Voice frequencies: roughly 85Hz - 2000Hz
      // At 24kHz sample rate with 2048 FFT: bin width = 24000/2048 ≈ 11.7Hz
      const startBin = Math.floor(85 / 11.7); // ~7
      const endBin = Math.floor(2000 / 11.7); // ~170
      filteredResult = result.slice(startBin, endBin);
    } else if (analysisType === 'music') {
      // Music frequencies: roughly 20Hz - 4000Hz  
      const startBin = Math.floor(20 / 11.7); // ~2
      const endBin = Math.floor(4000 / 11.7); // ~340
      filteredResult = result.slice(startBin, endBin);
    }
    
    return {
      values: filteredResult,
      peaks: []
    };
  }
}

// Make available globally for compatibility
globalThis.ModernAudioRecorder = ModernAudioRecorder;