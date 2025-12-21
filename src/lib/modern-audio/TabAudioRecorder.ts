import { DEBUG_CONFIG, PERFORMANCE_CONFIG } from '../config/performance.js';

/* global chrome */

/**
 * Tab Audio Recorder for browser extension
 * Captures audio from the current tab using Chrome's tabCapture API
 *
 * Used for translating other meeting participants' voices in video conferencing
 * The audio is captured via the background script and processed in the side panel
 *
 * @class
 */
export class TabAudioRecorder {
  private sampleRate: number;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private dummyGain: GainNode | null = null;
  private useAudioWorklet: boolean = false;
  private recording: boolean = false;
  private onAudioData: ((data: { mono: Int16Array; raw: Int16Array }) => void) | null = null;
  private _audioChunkCount: number = 0;
  private tabId: number | null = null;
  private streamId: string | null = null;

  /**
   * Create a new TabAudioRecorder instance
   * @param sampleRate - Audio sample rate (default: 24000)
   */
  constructor(sampleRate = 24000) {
    this.sampleRate = sampleRate;

    // Pre-bind method to avoid runtime binding
    this._processAudioData = this._processAudioData.bind(this);
  }

  /**
   * Retrieves the current sampleRate for the recorder
   */
  getSampleRate(): number {
    return this.sampleRate;
  }

  /**
   * Retrieves the current status of the recording
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
   * Get the tab ID from URL params or query chrome.tabs
   */
  private async getTabIdFromContext(): Promise<number | null> {
    // Try to get from URL params first
    const urlParams = new URLSearchParams(window.location.search);
    const tabIdParam = urlParams.get('tabId');
    if (tabIdParam) {
      return parseInt(tabIdParam, 10);
    }

    // Fallback: query chrome.tabs for current active tab
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0 && tabs[0].id) {
          return tabs[0].id;
        }
      } catch (error) {
        console.error('[TabAudioRecorder] Error querying tabs:', error);
      }
    }

    return null;
  }

  /**
   * Begin capturing audio from the tab
   * @param tabId - Optional tab ID (will auto-detect if not provided)
   */
  async begin(tabId?: number): Promise<boolean> {
    if (this.stream) {
      throw new Error('TabAudioRecorder: Already connected. Please call .end() to start over');
    }

    try {
      // Get tab ID
      this.tabId = tabId ?? (await this.getTabIdFromContext());
      if (!this.tabId) {
        throw new Error('Could not determine tab ID for audio capture');
      }

      console.info('[TabAudioRecorder] Starting capture for tab:', this.tabId);

      // Request stream ID from background script
      const response = await this.sendMessageToBackground({
        type: 'START_TAB_CAPTURE',
        tabId: this.tabId
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to start tab capture');
      }

      this.streamId = response.streamId;
      console.info('[TabAudioRecorder] Got stream ID:', this.streamId);

      // Get the media stream using the stream ID
      // Chrome uses chromeMediaSource and chromeMediaSourceId constraints
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // @ts-expect-error Chrome-specific constraints
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: this.streamId
          }
        },
        video: false
      });

      // Verify track settings
      const track = this.stream.getAudioTracks()[0];
      const settings = track.getSettings();
      console.info('[TabAudioRecorder] Track settings:', settings);

      // Create AudioContext
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Setup audio processing
      await this.setupRealtimeAudioProcessing();

      console.info('[TabAudioRecorder] Tab audio capture ready');
      return true;

    } catch (error) {
      console.error('[TabAudioRecorder] Failed to start capture:', error);
      await this.cleanup();
      return false;
    }
  }

  /**
   * Send message to background script
   */
  private sendMessageToBackground(message: object): Promise<{ success: boolean; streamId?: string; error?: string }> {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { success: false, error: 'No response' });
          }
        });
      } else {
        resolve({ success: false, error: 'Chrome runtime not available' });
      }
    });
  }

  /**
   * Get the URL for the AudioWorklet processor
   */
  private getAudioWorkletProcessorUrl(): string {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL('worklets/audio-recorder-worklet-processor.js');
    }
    return new URL('../../services/worklets/audio-recorder-worklet-processor.js', import.meta.url).href;
  }

  /**
   * Check if AudioWorklet is supported
   */
  private isAudioWorkletSupported(): boolean {
    return typeof AudioWorkletNode !== 'undefined' &&
           this.audioContext !== null &&
           this.audioContext.audioWorklet !== undefined;
  }

  /**
   * Setup real-time audio processing
   */
  private async setupRealtimeAudioProcessing(): Promise<void> {
    if (!this.audioContext || !this.stream) {
      throw new Error('AudioContext and stream required for audio processing');
    }

    // Create MediaStreamSource
    this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.stream);

    // Check if AudioWorklet is supported
    this.useAudioWorklet = this.isAudioWorkletSupported();

    if (this.useAudioWorklet) {
      try {
        console.info('[TabAudioRecorder] Using AudioWorklet for audio processing');

        // Load the AudioWorklet module
        const workletUrl = this.getAudioWorkletProcessorUrl();
        await this.audioContext.audioWorklet.addModule(workletUrl);

        // Create AudioWorkletNode
        this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'audio-recorder-processor');

        // Handle messages from the worklet
        this.audioWorkletNode.port.onmessage = (event) => {
          if (event.data.type === 'audioData') {
            const { pcmData } = event.data;

            // Log periodically
            if (DEBUG_CONFIG.ENABLE_AUDIO_CHUNK_LOGGING) {
              this._audioChunkCount = (this._audioChunkCount || 0) + 1;
              if (this._audioChunkCount % DEBUG_CONFIG.AUDIO_CHUNK_LOG_INTERVAL === 0) {
                console.debug(`[TabAudioRecorder] AudioWorklet chunk ${this._audioChunkCount}, PCM length: ${pcmData.length}`);
              }
            }

            this._processAudioData(pcmData);
          }
        };

        // Connect nodes
        this.mediaStreamSource.connect(this.audioWorkletNode);

        // Create dummy gain node to keep worklet active
        this.dummyGain = this.audioContext.createGain();
        this.dummyGain.gain.value = 0;
        this.audioWorkletNode.connect(this.dummyGain);
        this.dummyGain.connect(this.audioContext.destination);

      } catch (error) {
        console.warn('[TabAudioRecorder] AudioWorklet setup failed, falling back to ScriptProcessor:', error);
        this.useAudioWorklet = false;
        await this.setupScriptProcessorFallback();
      }
    } else {
      console.info('[TabAudioRecorder] AudioWorklet not supported, using ScriptProcessor fallback');
      await this.setupScriptProcessorFallback();
    }

    console.info('[TabAudioRecorder] Audio processing setup complete');
  }

  /**
   * Setup ScriptProcessor as fallback
   */
  private async setupScriptProcessorFallback(): Promise<void> {
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
          console.debug(`[TabAudioRecorder] ScriptProcessor chunk ${this._audioChunkCount}, PCM length: ${pcmData.length}`);
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
   * Start recording tab audio
   * @param chunkProcessor - Callback function to receive audio chunks
   */
  async record(chunkProcessor: (data: { mono: Int16Array; raw: Int16Array }) => void): Promise<boolean> {
    if (!this.stream) {
      throw new Error('Session ended: please call .begin() first');
    } else if (this.recording) {
      throw new Error('Already recording: please call .pause() first');
    } else if (typeof chunkProcessor !== 'function') {
      throw new Error('chunkProcessor must be a function');
    }

    this.onAudioData = chunkProcessor;
    this.recording = true;

    console.info('[TabAudioRecorder] Recording started');

    // Send start command to worklet
    if (this.audioWorkletNode) {
      this.audioWorkletNode.port.postMessage({ type: 'start' });
    }

    return true;
  }

  /**
   * Pause the recording
   */
  async pause(): Promise<boolean> {
    if (!this.stream) {
      throw new Error('Session ended: please call .begin() first');
    } else if (!this.recording) {
      throw new Error('Already paused: please call .record() first');
    }

    console.info('[TabAudioRecorder] Pausing recording');

    // Send stop command to worklet
    if (this.audioWorkletNode) {
      this.audioWorkletNode.port.postMessage({ type: 'stop' });
    }

    this.recording = false;
    return true;
  }

  /**
   * End recording session and clean up
   */
  async end(): Promise<void> {
    console.info('[TabAudioRecorder] Stopping tab audio capture');

    // Stop recording if active
    if (this.recording) {
      await this.pause();
    }

    // Notify background script to stop capture
    await this.sendMessageToBackground({ type: 'STOP_TAB_CAPTURE' });

    // Clean up resources
    await this.cleanup();
  }

  /**
   * Clean up audio resources
   */
  private async cleanup(): Promise<void> {
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
    this.tabId = null;
    this.streamId = null;

    console.info('[TabAudioRecorder] Tab audio capture ended');
  }

  /**
   * Process audio data through callback
   */
  private _processAudioData(pcmData: Int16Array): void {
    if (this.onAudioData && typeof this.onAudioData === 'function' && pcmData.length > 0 && this.recording) {
      try {
        this.onAudioData({
          mono: pcmData,
          raw: pcmData,
        });
      } catch (error) {
        console.error('[TabAudioRecorder] Error in onAudioData callback:', error);
      }
    }
  }
}
