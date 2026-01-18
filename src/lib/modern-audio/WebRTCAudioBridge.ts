/**
 * WebRTCAudioBridge
 *
 * Bridges WebRTC audio streams with the existing audio infrastructure.
 * Provides methods to:
 * - Get local microphone stream for WebRTC
 * - Handle remote audio stream from WebRTC
 * - Support device switching
 * - Provide frequency data for visualization
 */

export interface WebRTCAudioBridgeOptions {
  /** Sample rate for audio processing (default: 24000) */
  sampleRate?: number;
  /** Echo cancellation enabled (default: true) */
  echoCancellation?: boolean;
  /** Noise suppression enabled (default: true) */
  noiseSuppression?: boolean;
  /** Auto gain control enabled (default: true) */
  autoGainControl?: boolean;
}

const DEFAULT_OPTIONS: WebRTCAudioBridgeOptions = {
  sampleRate: 24000,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};

export class WebRTCAudioBridge {
  private options: Required<WebRTCAudioBridgeOptions>;
  private localStream: MediaStream | null = null;
  private remoteAudioElement: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private remoteSourceNode: MediaStreamAudioSourceNode | null = null;
  private currentInputDeviceId: string | undefined;
  private currentOutputDeviceId: string | undefined;

  constructor(options?: WebRTCAudioBridgeOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options } as Required<WebRTCAudioBridgeOptions>;
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
   * Creates an audio element to play the remote stream
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

    // Create audio context for visualization
    this.setupAnalyser(stream);

    console.debug('[WebRTCAudioBridge] Remote stream connected');
  }

  /**
   * Set up analyser node for frequency visualization
   */
  private setupAnalyser(stream: MediaStream): void {
    try {
      this.audioContext = new AudioContext({
        sampleRate: this.options.sampleRate
      });

      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.8;

      this.remoteSourceNode = this.audioContext.createMediaStreamSource(stream);
      this.remoteSourceNode.connect(this.analyserNode);
      // Note: We don't connect to destination since HTMLAudioElement handles playback

      console.debug('[WebRTCAudioBridge] Analyser set up for visualization');
    } catch (error) {
      console.warn('[WebRTCAudioBridge] Failed to set up analyser:', error);
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
