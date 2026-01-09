import { DEBUG_CONFIG, PERFORMANCE_CONFIG } from '../config/performance.js';

/* global chrome */

/**
 * Base class for audio recording with AudioWorklet and ScriptProcessor fallback
 * Provides shared functionality for all audio recorders (speaker and participant)
 */
export abstract class BaseAudioRecorder {
  protected sampleRate: number;
  protected stream: MediaStream | null = null;
  protected audioContext: AudioContext | null = null;
  protected mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  protected audioWorkletNode: AudioWorkletNode | null = null;
  protected scriptProcessor: ScriptProcessorNode | null = null;
  protected dummyGain: GainNode | null = null;
  protected useAudioWorklet: boolean = false;
  protected recording: boolean = false;
  protected onAudioData: ((data: { mono: Int16Array; raw: Int16Array }) => void) | null = null;
  protected _audioChunkCount: number = 0;

  constructor(sampleRate: number = 24000) {
    this.sampleRate = sampleRate;
    // Pre-bind method to avoid runtime binding
    this._processAudioData = this._processAudioData.bind(this);
  }

  /**
   * Get the current sample rate
   */
  getSampleRate(): number {
    return this.sampleRate;
  }

  /**
   * Get the current recording status
   */
  getStatus(): 'ended' | 'paused' | 'recording' {
    if (!this.stream) {
      return 'ended';
    } else if (!this.recording) {
      return 'paused';
    } else {
      return 'recording';
    }
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.recording;
  }

  /**
   * Get the URL for the AudioWorklet processor
   * Handles both extension and regular web/Electron environments
   */
  protected getAudioWorkletProcessorUrl(): string {
    // Check if we're in a Chrome extension environment
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL('worklets/audio-recorder-worklet-processor.js');
    }
    // For regular web/Electron environments
    return new URL('../../services/worklets/audio-recorder-worklet-processor.js', import.meta.url).href;
  }

  /**
   * Check if AudioWorklet is supported
   */
  protected isAudioWorkletSupported(): boolean {
    return typeof AudioWorkletNode !== 'undefined' &&
           this.audioContext !== null &&
           this.audioContext.audioWorklet !== undefined;
  }

  /**
   * Get the logger prefix for this recorder
   * Override in subclasses for specific logging
   */
  protected abstract getLogPrefix(): string;

  /**
   * Whether to connect audio to destination for playback
   * Override in subclasses (e.g., TabAudioRecorder needs this for tab capture)
   */
  protected shouldConnectToDestination(): boolean {
    return false;
  }

  /**
   * Setup real-time audio processing with AudioWorklet or ScriptProcessor fallback
   */
  protected async setupRealtimeAudioProcessing(): Promise<void> {
    if (!this.audioContext || !this.stream) {
      throw new Error('AudioContext and stream required for real-time processing');
    }

    // Create MediaStreamSource
    this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.stream);

    // Check if AudioWorklet is supported
    this.useAudioWorklet = this.isAudioWorkletSupported();

    if (this.useAudioWorklet) {
      try {
        console.info(`${this.getLogPrefix()} Using AudioWorklet for audio processing`);

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
                console.debug(`${this.getLogPrefix()} AudioWorklet chunk ${this._audioChunkCount}, PCM length: ${pcmData.length}`);
              }
            }

            // Send audio data through callback
            this._processAudioData(pcmData);
          }
        };

        // Connect nodes
        this.mediaStreamSource.connect(this.audioWorkletNode);

        // Connect to destination if needed (e.g., for tab capture audio passthrough)
        if (this.shouldConnectToDestination()) {
          this.mediaStreamSource.connect(this.audioContext.destination);
        } else {
          // Create dummy gain node to keep worklet active
          this.dummyGain = this.audioContext.createGain();
          this.dummyGain.gain.value = 0; // Mute the output
          this.audioWorkletNode.connect(this.dummyGain);
          this.dummyGain.connect(this.audioContext.destination);
        }

      } catch (error) {
        console.warn(`${this.getLogPrefix()} Failed to setup AudioWorklet, falling back to ScriptProcessor:`, error);
        this.useAudioWorklet = false;
        await this.setupScriptProcessorFallback();
      }
    } else {
      console.info(`${this.getLogPrefix()} AudioWorklet not supported, using ScriptProcessor fallback`);
      await this.setupScriptProcessorFallback();
    }

    console.info(`${this.getLogPrefix()} Real-time audio processing setup complete`);
  }

  /**
   * Setup ScriptProcessor as fallback for browsers without AudioWorklet support
   */
  protected async setupScriptProcessorFallback(): Promise<void> {
    if (!this.audioContext || !this.mediaStreamSource) {
      throw new Error('AudioContext and source required for ScriptProcessor');
    }

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
          console.debug(`${this.getLogPrefix()} ScriptProcessor chunk ${this._audioChunkCount}, PCM length: ${pcmData.length}`);
        }
      }

      this._processAudioData(pcmData);
    };

    // Connect the nodes
    this.mediaStreamSource.connect(this.scriptProcessor);

    // Connect to destination if needed
    if (this.shouldConnectToDestination()) {
      this.mediaStreamSource.connect(this.audioContext.destination);
      // ScriptProcessor needs to be connected to destination to work
      this.scriptProcessor.connect(this.audioContext.destination);
    } else {
      // Create a dummy gain node with zero volume
      this.dummyGain = this.audioContext.createGain();
      this.dummyGain.gain.value = 0;
      this.scriptProcessor.connect(this.dummyGain);
      this.dummyGain.connect(this.audioContext.destination);
    }
  }

  /**
   * Process audio data through callback
   */
  protected _processAudioData(pcmData: Int16Array): void {
    if (this.onAudioData && typeof this.onAudioData === 'function' && pcmData.length > 0 && this.recording) {
      try {
        this.onAudioData({
          mono: pcmData,
          raw: pcmData,
        });
      } catch (error) {
        console.error(`${this.getLogPrefix()} Error in onAudioData callback:`, error);
      }
    }
  }

  /**
   * Start the recording (send start command to worklet and set flag)
   */
  protected startRecording(): void {
    this.recording = true;
    console.info(`${this.getLogPrefix()} Recording started`);

    // Send start command to worklet
    if (this.audioWorkletNode) {
      this.audioWorkletNode.port.postMessage({ type: 'start' });
    }
  }

  /**
   * Stop the recording (send stop command to worklet and set flag)
   */
  protected stopRecording(): void {
    console.info(`${this.getLogPrefix()} Pausing recording`);

    // Send stop command to worklet
    if (this.audioWorkletNode) {
      this.audioWorkletNode.port.postMessage({ type: 'stop' });
    }

    this.recording = false;
  }

  /**
   * Clean up all audio resources
   */
  protected async cleanup(): Promise<void> {
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

    console.info(`${this.getLogPrefix()} Audio capture ended`);
  }
}
