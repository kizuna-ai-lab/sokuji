/**
 * WebRTCAudioBridge
 *
 * Bridges WebRTC audio streams with the existing audio infrastructure.
 * Provides methods to:
 * - Get local microphone stream for WebRTC
 * - Handle remote audio stream from WebRTC
 * - Extract PCM audio data for virtual microphone injection
 * - Support device switching
 * - Provide frequency data for visualization
 */

import { isExtension, hasChromeRuntime } from '../../utils/environment';
import type { RemoteAudioTrack } from 'livekit-client';

/**
 * Gets the URL for the PCM processor AudioWorklet.
 * Handles different pathing requirements for Chrome Extensions and Electron/web environments.
 */
function getPCMWorkletProcessorSrc(): string {
  if (isExtension() && hasChromeRuntime() && window.chrome?.runtime?.getURL) {
    return window.chrome.runtime.getURL('worklets/pcm-audio-worklet-processor.js');
  } else {
    return new URL('../../services/worklets/pcm-audio-worklet-processor.js', import.meta.url).href;
  }
}

/**
 * Metadata for buffered audio data
 */
export interface BufferedAudioMetadata {
  /** Sequence number for ordering audio chunks */
  sequenceNumber: number;
  /** Timestamp when buffer was flushed */
  timestamp: number;
}

/**
 * Callback type for buffered audio data with metadata
 */
export type OnBufferedAudioDataCallback = (
  data: Int16Array,
  metadata: BufferedAudioMetadata
) => void;

export interface WebRTCAudioBridgeOptions {
  /** Sample rate for audio processing (default: 24000) */
  sampleRate?: number;
  /** Echo cancellation enabled (default: true) */
  echoCancellation?: boolean;
  /** Noise suppression enabled (default: true) */
  noiseSuppression?: boolean;
  /** Auto gain control enabled (default: true) */
  autoGainControl?: boolean;
  /** Callback for raw PCM audio data (unbuffered) extracted from remote stream */
  onAudioData?: (pcmData: Int16Array) => void;
  /** Enable PCM buffering to prevent audio stuttering (default: false) */
  enablePCMBuffering?: boolean;
  /** Buffer threshold in milliseconds before flushing (default: 150ms) */
  pcmBufferThresholdMs?: number;
  /** Maximum time to hold buffer before flushing (default: 100ms) */
  pcmFlushTimeoutMs?: number;
}

const DEFAULT_OPTIONS: WebRTCAudioBridgeOptions = {
  sampleRate: 24000,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  enablePCMBuffering: false,
  pcmBufferThresholdMs: 150,
  pcmFlushTimeoutMs: 100
};

export class WebRTCAudioBridge {
  private options: WebRTCAudioBridgeOptions;
  private localStream: MediaStream | null = null;
  private remoteAudioElement: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private remoteSourceNode: MediaStreamAudioSourceNode | null = null;
  private pcmWorkletNode: AudioWorkletNode | null = null;
  private currentInputDeviceId: string | undefined;
  private currentOutputDeviceId: string | undefined;
  private onAudioData: ((pcmData: Int16Array) => void) | undefined;

  // PCM buffering properties
  private pcmBuffer: Int16Array = new Int16Array(0);
  private pcmBufferThreshold: number;
  private pcmFlushTimeoutMs: number;
  private flushTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private sequenceNumber: number = 0;

  /** Callback for buffered audio data with metadata */
  public onBufferedAudioData?: OnBufferedAudioDataCallback;

  constructor(options?: WebRTCAudioBridgeOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.onAudioData = options?.onAudioData;

    // Calculate PCM buffer threshold in samples from milliseconds
    // sampleRate samples per second, so threshold_ms * sampleRate / 1000 = samples
    const sampleRate = this.options.sampleRate ?? 24000;
    const thresholdMs = this.options.pcmBufferThresholdMs ?? 150;
    this.pcmBufferThreshold = Math.floor(sampleRate * thresholdMs / 1000);
    this.pcmFlushTimeoutMs = this.options.pcmFlushTimeoutMs ?? 100;
  }

  /**
   * Set the callback for PCM audio data
   * @param callback - Function to receive PCM data from remote stream
   */
  setOnAudioData(callback: (pcmData: Int16Array) => void): void {
    this.onAudioData = callback;
  }

  /**
   * Handle incoming PCM audio data
   * If buffering is enabled, accumulates data and emits when threshold is reached
   * Otherwise, emits immediately via onAudioData callback
   */
  private handlePcmData(pcmData: Int16Array): void {
    if (this.options.enablePCMBuffering && this.onBufferedAudioData) {
      // Accumulate PCM data into buffer
      const newBuffer = new Int16Array(this.pcmBuffer.length + pcmData.length);
      newBuffer.set(this.pcmBuffer);
      newBuffer.set(pcmData, this.pcmBuffer.length);
      this.pcmBuffer = newBuffer;

      // Check if buffer has reached threshold for smooth playback
      if (this.pcmBuffer.length >= this.pcmBufferThreshold) {
        this.flushPcmBuffer();
      } else {
        // Schedule a flush to ensure we don't hold audio too long
        this.scheduleFlush();
      }
    } else {
      // No buffering - emit immediately
      this.onAudioData?.(pcmData);
    }
  }

  /**
   * Flush accumulated PCM buffer and emit buffered audio data
   */
  private flushPcmBuffer(): void {
    if (this.pcmBuffer.length === 0) return;

    this.clearFlushTimeout();

    const sequenceNumber = ++this.sequenceNumber;
    const timestamp = Date.now();

    // Emit aggregated audio data with metadata
    this.onBufferedAudioData?.(this.pcmBuffer, { sequenceNumber, timestamp });

    // Clear buffer after sending
    this.pcmBuffer = new Int16Array(0);
  }

  /**
   * Schedule a buffer flush after timeout to prevent holding audio too long
   */
  private scheduleFlush(): void {
    // Don't schedule if one is already pending
    if (this.flushTimeoutId) return;

    this.flushTimeoutId = setTimeout(() => {
      this.flushTimeoutId = null;
      if (this.pcmBuffer.length > 0) {
        this.flushPcmBuffer();
      }
    }, this.pcmFlushTimeoutMs);
  }

  /**
   * Clear any pending flush timeout
   */
  private clearFlushTimeout(): void {
    if (this.flushTimeoutId) {
      clearTimeout(this.flushTimeoutId);
      this.flushTimeoutId = null;
    }
  }

  /**
   * Get local microphone stream for WebRTC
   * @param deviceId - Optional specific device ID to use
   * @returns MediaStream from the microphone
   */
  async getLocalStream(deviceId?: string): Promise<MediaStream> {
    // If we already have a stream with the same device, reuse it
    if (this.localStream && deviceId === this.currentInputDeviceId) {
      return this.localStream;
    }

    // Stop existing stream if switching devices
    if (this.localStream) {
      this.stopLocalStream();
    }

    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: this.options.echoCancellation,
        noiseSuppression: this.options.noiseSuppression,
        autoGainControl: this.options.autoGainControl,
        sampleRate: this.options.sampleRate
      },
      video: false
    };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.currentInputDeviceId = deviceId;

      console.debug('[WebRTCAudioBridge] Got local stream from device:', deviceId || 'default');
      return this.localStream;
    } catch (error) {
      console.error('[WebRTCAudioBridge] Error getting local stream:', error);
      throw error;
    }
  }

  /**
   * Handle remote audio stream from WebRTC
   * Creates an audio element to play the remote stream and extracts PCM data
   * @param stream - The remote MediaStream from WebRTC
   * @param outputDeviceId - Optional output device ID
   */
  async handleRemoteStream(stream: MediaStream, outputDeviceId?: string): Promise<void> {
    // Clean up existing remote audio
    this.cleanupRemoteAudio();

    // Create audio element for playback
    this.remoteAudioElement = new Audio();
    this.remoteAudioElement.srcObject = stream;
    this.remoteAudioElement.autoplay = true;
    this.remoteAudioElement.muted = true;

    // Set output device if supported and specified
    if (outputDeviceId && 'setSinkId' in this.remoteAudioElement) {
      try {
        await (this.remoteAudioElement as any).setSinkId(outputDeviceId);
        this.currentOutputDeviceId = outputDeviceId;
        console.debug('[WebRTCAudioBridge] Set output device to:', outputDeviceId);
      } catch (error) {
        console.warn('[WebRTCAudioBridge] Failed to set output device:', error);
      }
    }

    // Create audio context for visualization and PCM extraction
    await this.setupAudioProcessing(stream);

    console.debug('[WebRTCAudioBridge] Remote stream connected');
  }

  /**
   * Handle LiveKit remote audio track
   * Creates an audio element to activate the decoder and extracts PCM data
   * @param track - The LiveKit RemoteAudioTrack
   * @param options - Options for handling the track
   */
  async handleLiveKitTrack(
    track: RemoteAudioTrack,
    options?: {
      /** Append audio element to document body (required for some browsers) */
      appendToBody?: boolean;
    }
  ): Promise<void> {
    // Clean up existing remote audio
    this.cleanupRemoteAudio();

    // Step 1: Attach track to a hidden, muted audio element to activate the WebRTC decoder
    // This is required for LiveKit to properly decode the audio stream
    this.remoteAudioElement = track.attach();
    this.remoteAudioElement.muted = true;
    this.remoteAudioElement.volume = 0;
    this.remoteAudioElement.style.display = 'none';

    // Some browsers (especially in extensions) require the audio element to be in the DOM
    if (options?.appendToBody) {
      document.body.appendChild(this.remoteAudioElement);
    }

    // Step 2: Get the MediaStream from the track
    const stream = new MediaStream([track.mediaStreamTrack]);

    // Step 3: Set up audio processing (same as handleRemoteStream)
    await this.setupAudioProcessing(stream);

    console.debug('[WebRTCAudioBridge] LiveKit track connected');
  }

  /**
   * Handle LiveKit remote audio track WITH direct playback
   * This allows browser AEC to see the audio output, preventing echo feedback.
   * Unlike handleLiveKitTrack(), this method plays audio directly through HTMLAudioElement
   * instead of extracting PCM data for ModernAudioPlayer.
   *
   * @param track - The LiveKit RemoteAudioTrack
   * @param options - Options for handling the track
   */
  async handleLiveKitTrackWithPlayback(
    track: RemoteAudioTrack,
    options?: {
      /** Append audio element to document body (required for some browsers) */
      appendToBody?: boolean;
      /** Output device ID for setSinkId */
      outputDeviceId?: string;
    }
  ): Promise<void> {
    // Clean up existing remote audio
    this.cleanupRemoteAudio();

    // Attach track to audio element - NOT muted, for AEC visibility
    // The browser's AEC needs to see the audio output to cancel it from microphone input
    this.remoteAudioElement = track.attach();
    this.remoteAudioElement.autoplay = true;
    this.remoteAudioElement.muted = false;  // Key: don't mute, let AEC see the audio
    this.remoteAudioElement.volume = 1.0;   // Key: full volume for proper AEC operation

    // Set output device if supported and specified
    if (options?.outputDeviceId && 'setSinkId' in this.remoteAudioElement) {
      try {
        await (this.remoteAudioElement as any).setSinkId(options.outputDeviceId);
        this.currentOutputDeviceId = options.outputDeviceId;
        console.debug('[WebRTCAudioBridge] Set output device to:', options.outputDeviceId);
      } catch (error) {
        console.warn('[WebRTCAudioBridge] Failed to set output device:', error);
      }
    }

    // Append to body if required (needed for some browsers, especially extensions)
    if (options?.appendToBody) {
      document.body.appendChild(this.remoteAudioElement);
    }

    // Set up audio context for visualization only (no PCM extraction needed)
    // Since we're playing directly through HTMLAudioElement, we don't need to extract PCM
    const stream = new MediaStream([track.mediaStreamTrack]);
    await this.setupAudioProcessingForVisualizationOnly(stream);

    console.debug('[WebRTCAudioBridge] LiveKit track with direct playback connected');
  }

  /**
   * Set up audio processing for visualization only (no PCM extraction)
   * Used when audio is played directly through HTMLAudioElement and we only need
   * frequency data for visualization purposes.
   */
  private async setupAudioProcessingForVisualizationOnly(stream: MediaStream): Promise<void> {
    try {
      const sampleRate = this.options.sampleRate ?? 24000;
      this.audioContext = new AudioContext({ sampleRate });

      // Create source node from stream
      this.remoteSourceNode = this.audioContext.createMediaStreamSource(stream);

      // Set up analyser for visualization only
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.8;
      this.remoteSourceNode.connect(this.analyserNode);
      // Note: Don't connect to destination - audio plays via HTMLAudioElement
      // Note: Don't set up PCM worklet - we don't need to extract PCM data

      console.debug('[WebRTCAudioBridge] Audio processing for visualization set up');
    } catch (error) {
      console.warn('[WebRTCAudioBridge] Failed to set up visualization audio processing:', error);
    }
  }

  /**
   * Set up audio processing with AudioWorklet for PCM extraction
   */
  private async setupAudioProcessing(stream: MediaStream): Promise<void> {
    try {
      const sampleRate = this.options.sampleRate ?? 24000;
      this.audioContext = new AudioContext({ sampleRate });

      // Create source node from stream
      this.remoteSourceNode = this.audioContext.createMediaStreamSource(stream);

      // Set up analyser for visualization
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.8;
      this.remoteSourceNode.connect(this.analyserNode);
      // Note: analyser doesn't need to connect to destination

      // Set up AudioWorklet for PCM extraction if callback is provided
      if (this.onAudioData || this.onBufferedAudioData) {
        try {
          const workletUrl = getPCMWorkletProcessorSrc();
          await this.audioContext.audioWorklet.addModule(workletUrl);

          this.pcmWorkletNode = new AudioWorkletNode(this.audioContext, 'pcm-processor');

          // Connect: source -> worklet -> destination (muted, just to keep worklet active)
          this.remoteSourceNode.connect(this.pcmWorkletNode);
          // Don't connect worklet to destination - we don't want double audio playback
          // The HTMLAudioElement handles playback, worklet just extracts PCM

          // Handle PCM data from worklet - routes through buffering if enabled
          this.pcmWorkletNode.port.onmessage = (event) => {
            const pcmData = event.data as Int16Array;
            this.handlePcmData(pcmData);
          };

          console.debug('[WebRTCAudioBridge] AudioWorklet set up for PCM extraction');
        } catch (error) {
          console.warn('[WebRTCAudioBridge] Failed to set up AudioWorklet, PCM extraction disabled:', error);
        }
      }

      console.debug('[WebRTCAudioBridge] Audio processing set up');
    } catch (error) {
      console.warn('[WebRTCAudioBridge] Failed to set up audio processing:', error);
    }
  }

  /**
   * Get frequency data for visualization
   * Compatible with existing visualization API
   * @returns Object with frequencies array, or null if not available
   */
  getFrequencies(): { values: Float32Array } | null {
    if (!this.analyserNode) {
      return null;
    }

    const frequencies = new Float32Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getFloatFrequencyData(frequencies);

    // Normalize to 0-1 range (dB values are typically -100 to 0)
    const normalized = new Float32Array(frequencies.length);
    for (let i = 0; i < frequencies.length; i++) {
      // Convert dB to linear scale (0-1)
      normalized[i] = Math.max(0, Math.min(1, (frequencies[i] + 100) / 100));
    }

    return { values: normalized };
  }

  /**
   * Set output device for remote audio playback
   * @param deviceId - The device ID to use for output
   */
  async setOutputDevice(deviceId: string): Promise<void> {
    if (!this.remoteAudioElement) {
      this.currentOutputDeviceId = deviceId;
      return;
    }

    if ('setSinkId' in this.remoteAudioElement) {
      try {
        await (this.remoteAudioElement as any).setSinkId(deviceId);
        this.currentOutputDeviceId = deviceId;
        console.debug('[WebRTCAudioBridge] Output device changed to:', deviceId);
      } catch (error) {
        console.warn('[WebRTCAudioBridge] Failed to change output device:', error);
        throw error;
      }
    } else {
      console.warn('[WebRTCAudioBridge] setSinkId not supported in this browser');
    }
  }

  /**
   * Set volume for remote audio playback
   * @param volume - Volume level (0.0 to 1.0)
   */
  setVolume(volume: number): void {
    if (this.remoteAudioElement) {
      this.remoteAudioElement.volume = Math.max(0, Math.min(1, volume));
    }
  }

  /**
   * Get current volume level
   */
  getVolume(): number {
    return this.remoteAudioElement?.volume ?? 1;
  }

  /**
   * Mute/unmute remote audio
   */
  setMuted(muted: boolean): void {
    if (this.remoteAudioElement) {
      this.remoteAudioElement.muted = muted;
    }
  }

  /**
   * Check if remote audio is muted
   */
  isMuted(): boolean {
    return this.remoteAudioElement?.muted ?? false;
  }

  /**
   * Stop local stream and release resources
   */
  stopLocalStream(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
      this.currentInputDeviceId = undefined;
      console.debug('[WebRTCAudioBridge] Local stream stopped');
    }
  }

  /**
   * Clean up remote audio resources
   */
  private cleanupRemoteAudio(): void {
    // Clear PCM buffering state
    this.clearFlushTimeout();
    // Flush any remaining buffer before cleanup
    if (this.pcmBuffer.length > 0 && this.onBufferedAudioData) {
      this.flushPcmBuffer();
    }
    this.pcmBuffer = new Int16Array(0);

    if (this.pcmWorkletNode) {
      this.pcmWorkletNode.port.onmessage = null;
      this.pcmWorkletNode.disconnect();
      this.pcmWorkletNode = null;
    }

    if (this.remoteSourceNode) {
      this.remoteSourceNode.disconnect();
      this.remoteSourceNode = null;
    }

    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(console.warn);
      this.audioContext = null;
    }

    if (this.remoteAudioElement) {
      this.remoteAudioElement.pause();
      this.remoteAudioElement.srcObject = null;
      // Remove from DOM if it was appended (for LiveKit)
      if (this.remoteAudioElement.parentNode) {
        this.remoteAudioElement.parentNode.removeChild(this.remoteAudioElement);
      }
      this.remoteAudioElement = null;
    }
  }

  /**
   * Clean up all resources
   */
  cleanup(): void {
    this.stopLocalStream();
    this.cleanupRemoteAudio();
    this.currentOutputDeviceId = undefined;
    console.debug('[WebRTCAudioBridge] Cleaned up all resources');
  }

  /**
   * Get the current local stream (if any)
   */
  getLocalMediaStream(): MediaStream | null {
    return this.localStream;
  }

  /**
   * Check if local stream is active
   */
  isLocalStreamActive(): boolean {
    return this.localStream !== null && this.localStream.active;
  }

  /**
   * Check if remote audio is playing
   */
  isRemoteAudioPlaying(): boolean {
    return this.remoteAudioElement !== null && !this.remoteAudioElement.paused;
  }
}
