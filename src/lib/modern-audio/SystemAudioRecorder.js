import { DEBUG_CONFIG, PERFORMANCE_CONFIG } from '../config/performance.js';

/**
 * System Audio Recorder for capturing system/loopback audio
 * Used for translating other meeting participants' voices
 *
 * Key differences from ModernAudioRecorder:
 * - No echo cancellation (system audio is already processed)
 * - No noise suppression or auto gain control
 * - No passthrough functionality
 * - Simplified for monitor/loopback source capture
 *
 * @class
 */
export class SystemAudioRecorder {
  /**
   * Create a new SystemAudioRecorder instance
   * @param {{sampleRate?: number}} [options]
   * @returns {SystemAudioRecorder}
   */
  constructor({
    sampleRate = 24000,
  } = {}) {
    // Config
    this.sampleRate = sampleRate;
    this._deviceChangeCallback = null;

    // State variables
    this.stream = null;
    this.recording = false;
    this.audioContext = null;
    this.mediaStreamSource = null;
    this.audioWorkletNode = null;
    this.scriptProcessor = null;
    this.dummyGain = null;
    this.useAudioWorklet = false;

    // Audio processing
    this.onAudioData = null;
    this._audioChunkCount = 0;

    // Performance optimization: Pre-bind method to avoid runtime binding
    this._processAudioData = this._processAudioData.bind(this);
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
    if (!this.stream) {
      return 'ended';
    } else if (!this.recording) {
      return 'paused';
    } else {
      return 'recording';
    }
  }

  /**
   * Get audio constraints for system audio capture
   * IMPORTANT: No echo cancellation for system audio
   * @private
   * @param {string} [deviceId] - Device ID (monitor source)
   * @returns {Object} Audio constraints
   */
  getAudioConstraints(deviceId) {
    return {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      sampleRate: this.sampleRate,
      channelCount: 1,
      latency: 0.02, // 20ms low latency
      // CRITICAL: Disable all processing for system audio
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
  }

  /**
   * Begin capturing from a system audio source (monitor/loopback)
   * @param {string} [deviceId] - Device ID of the monitor source
   * @returns {Promise<boolean>}
   */
  async begin(deviceId) {
    if (this.stream) {
      throw new Error(
        `SystemAudioRecorder: Already connected: please call .end() to start over`,
      );
    }

    const audioConstraints = this.getAudioConstraints(deviceId);
    const constraints = {
      audio: audioConstraints
    };

    try {
      console.info('[Sokuji] [SystemAudioRecorder] Starting system audio capture...');
      console.info('[Sokuji] [SystemAudioRecorder] Device ID:', deviceId || 'default');

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Verify settings
      const track = this.stream.getAudioTracks()[0];
      const settings = track.getSettings();
      console.info('[Sokuji] [SystemAudioRecorder] Track settings:', {
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
        deviceId: settings.deviceId,
      });

    } catch (err) {
      console.error('[Sokuji] [SystemAudioRecorder] Could not start system audio capture', err);
      return false;
    }

    // Create AudioContext for audio processing
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // Set up real-time audio processing
    await this.setupRealtimeAudioProcessing();

    console.info('[Sokuji] [SystemAudioRecorder] System audio capture ready');
    return true;
  }

  /**
   * Get the URL for the AudioWorklet processor
   * @private
   * @returns {string}
   */
  getAudioWorkletProcessorUrl() {
    // Check if we're in a Chrome extension environment
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL('worklets/audio-recorder-worklet-processor.js');
    }
    // For regular web/Electron environments
    return new URL('../../services/worklets/audio-recorder-worklet-processor.js', import.meta.url).href;
  }

  /**
   * Check if AudioWorklet is supported
   * @private
   * @returns {boolean}
   */
  isAudioWorkletSupported() {
    return typeof AudioWorkletNode !== 'undefined' &&
           this.audioContext &&
           this.audioContext.audioWorklet;
  }

  /**
   * Setup real-time audio processing
   * @private
   */
  async setupRealtimeAudioProcessing() {
    if (!this.audioContext || !this.stream) {
      throw new Error('AudioContext and stream required for real-time processing');
    }

    // Create MediaStreamSource
    this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.stream);

    // Check if AudioWorklet is supported
    this.useAudioWorklet = this.isAudioWorkletSupported();

    if (this.useAudioWorklet) {
      try {
        console.info('[Sokuji] [SystemAudioRecorder] Using AudioWorklet for audio processing');

        // Load the AudioWorklet module
        const workletUrl = this.getAudioWorkletProcessorUrl();
        await this.audioContext.audioWorklet.addModule(workletUrl);

        // Create AudioWorkletNode
        this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'audio-recorder-processor');

        // Handle messages from the worklet
        this.audioWorkletNode.port.onmessage = (event) => {
          if (event.data.type === 'audioData') {
            const { pcmData } = event.data;

            // Log periodically to verify data flow
            if (DEBUG_CONFIG.ENABLE_AUDIO_CHUNK_LOGGING) {
              this._audioChunkCount = (this._audioChunkCount || 0) + 1;
              if (this._audioChunkCount % DEBUG_CONFIG.AUDIO_CHUNK_LOG_INTERVAL === 0) {
                console.debug(`[Sokuji] [SystemAudioRecorder] AudioWorklet chunk ${this._audioChunkCount}, PCM length: ${pcmData.length}`);
              }
            }

            // Send audio data through callback
            this._processAudioData(pcmData);
          }
        };

        // Connect nodes
        this.mediaStreamSource.connect(this.audioWorkletNode);

        // Create dummy gain node to keep worklet active
        this.dummyGain = this.audioContext.createGain();
        this.dummyGain.gain.value = 0; // Mute the output
        this.audioWorkletNode.connect(this.dummyGain);
        this.dummyGain.connect(this.audioContext.destination);

      } catch (error) {
        console.warn('[Sokuji] [SystemAudioRecorder] Failed to setup AudioWorklet, falling back to ScriptProcessor:', error);
        this.useAudioWorklet = false;
        await this.setupScriptProcessorFallback();
      }
    } else {
      console.info('[Sokuji] [SystemAudioRecorder] AudioWorklet not supported, using ScriptProcessor fallback');
      await this.setupScriptProcessorFallback();
    }

    console.info('[Sokuji] [SystemAudioRecorder] Real-time audio processing setup complete');
  }

  /**
   * Setup ScriptProcessor as fallback
   * @private
   */
  async setupScriptProcessorFallback() {
    const bufferSize = PERFORMANCE_CONFIG.SCRIPT_PROCESSOR_BUFFER_SIZE;
    this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

    this.scriptProcessor.onaudioprocess = (event) => {
      const inputBuffer = event.inputBuffer;
      const inputData = inputBuffer.getChannelData(0);

      // Convert to PCM16
      const pcmData = new Int16Array(inputData.length);
      const len = inputData.length;

      const chunkSize = PERFORMANCE_CONFIG.PCM_CONVERSION_CHUNK_SIZE;
      for (let i = 0; i < len; i += chunkSize) {
        const end = Math.min(i + chunkSize, len);
        for (let j = i; j < end; j++) {
          const sample = inputData[j];
          pcmData[j] = sample >= 0
            ? Math.min(32767, sample * 32767)
            : Math.max(-32768, sample * 32768);
        }
      }

      // Log periodically
      if (DEBUG_CONFIG.ENABLE_AUDIO_CHUNK_LOGGING) {
        this._audioChunkCount = (this._audioChunkCount || 0) + 1;
        if (this._audioChunkCount % DEBUG_CONFIG.AUDIO_CHUNK_LOG_INTERVAL === 0) {
          console.debug(`[Sokuji] [SystemAudioRecorder] ScriptProcessor chunk ${this._audioChunkCount}, PCM length: ${pcmData.length}`);
        }
      }

      this._processAudioData(pcmData);
    };

    // Connect the nodes
    this.mediaStreamSource.connect(this.scriptProcessor);

    // Create a dummy gain node with zero volume
    this.dummyGain = this.audioContext.createGain();
    this.dummyGain.gain.value = 0;
    this.scriptProcessor.connect(this.dummyGain);
    this.dummyGain.connect(this.audioContext.destination);
  }

  /**
   * Start recording system audio
   * @param {(data: { mono: Int16Array; raw: Int16Array }) => any} [chunkProcessor]
   * @returns {Promise<true>}
   */
  async record(chunkProcessor = () => {}) {
    if (!this.stream) {
      throw new Error('Session ended: please call .begin() first');
    } else if (this.recording) {
      throw new Error('Already recording: please call .pause() first');
    } else if (typeof chunkProcessor !== 'function') {
      throw new Error(`chunkProcessor must be a function`);
    }

    this.onAudioData = chunkProcessor;
    this.recording = true;

    console.info('[Sokuji] [SystemAudioRecorder] Recording started');

    // Send start command to worklet
    if (this.audioWorkletNode) {
      this.audioWorkletNode.port.postMessage({ type: 'start' });
    }

    return true;
  }

  /**
   * Pause the recording
   * @returns {Promise<true>}
   */
  async pause() {
    if (!this.stream) {
      throw new Error('Session ended: please call .begin() first');
    } else if (!this.recording) {
      throw new Error('Already paused: please call .record() first');
    }

    console.info('[Sokuji] [SystemAudioRecorder] Pausing recording');

    // Send stop command to worklet
    if (this.audioWorkletNode) {
      this.audioWorkletNode.port.postMessage({ type: 'stop' });
    }

    this.recording = false;
    return true;
  }

  /**
   * End recording session and clean up
   * @returns {Promise<void>}
   */
  async end() {
    if (!this.stream) {
      return; // Already ended
    }

    console.info('[Sokuji] [SystemAudioRecorder] Stopping system audio capture');

    // Stop recording if active
    if (this.recording) {
      await this.pause();
    }

    // Stop all tracks
    if (this.stream) {
      const tracks = this.stream.getTracks();
      tracks.forEach((track) => track.stop());
      this.stream = null;
    }

    // Clean up audio processing nodes
    if (this.audioWorkletNode) {
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode.port.close();
      this.audioWorkletNode = null;
    }

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.dummyGain) {
      this.dummyGain.disconnect();
      this.dummyGain = null;
    }

    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }

    // Clean up AudioContext
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close();
      this.audioContext = null;
    }

    this.recording = false;
    this.onAudioData = null;

    console.info('[Sokuji] [SystemAudioRecorder] System audio capture ended');
  }

  /**
   * Process audio data through callback
   * @private
   * @param {Int16Array} pcmData
   */
  _processAudioData(pcmData) {
    if (this.onAudioData && typeof this.onAudioData === 'function' && pcmData.length > 0 && this.recording) {
      try {
        this.onAudioData({
          mono: pcmData,
          raw: pcmData,
        });
      } catch (error) {
        console.error('[Sokuji] [SystemAudioRecorder] Error in onAudioData callback:', error);
      }
    }
  }
}

// Make available globally for compatibility
globalThis.SystemAudioRecorder = SystemAudioRecorder;
