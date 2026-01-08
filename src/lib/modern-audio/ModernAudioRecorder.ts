import { BaseAudioRecorder } from './BaseAudioRecorder';
import { DEBUG_CONFIG, AUDIO_CONSTRAINT_PROFILES } from '../config/performance.js';

type PerformanceMode = 'high_quality' | 'performance' | 'minimal';

interface ModernAudioRecorderOptions {
  sampleRate?: number;
  enablePassthrough?: boolean;
  enableWarmup?: boolean;
  warmupDuration?: number;
  skipStartupFrames?: number;
  performanceMode?: PerformanceMode;
}

interface AudioDataWithMeta {
  mono: Int16Array;
  raw: Int16Array;
  isRecording: boolean;
  isPassthrough: boolean;
  passthroughVolume: number;
}

/**
 * Modern Audio Recorder using standard browser APIs
 * Extends BaseAudioRecorder with MediaRecorder, frequency analysis, and warmup support
 *
 * Unique features (not in base class):
 * - MediaRecorder integration for file saving
 * - Frequency analysis (getFrequencies)
 * - Warmup mechanism for first recording
 * - Passthrough functionality
 * - Device management (listDevices, listenForDeviceChange)
 * - Performance mode configuration
 */
export class ModernAudioRecorder extends BaseAudioRecorder {
  // MediaRecorder
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];

  // Frequency analysis
  private analyser: AnalyserNode | null = null;

  // Passthrough
  private _passthroughEnabled: boolean = false;
  private _passthroughVolume: number = 0.3;

  // Warmup
  private _isFirstRecording: boolean = true;
  private _enableWarmup: boolean;
  private _warmupDuration: number;
  private _skipStartupFrames: number;
  private _lastValidAudioChunk: Int16Array | null = null;

  // Performance
  private performanceMode: PerformanceMode;

  // Device management
  private _deviceChangeCallback: (() => void) | null = null;

  constructor(options: ModernAudioRecorderOptions = {}) {
    super(options.sampleRate ?? 24000);

    this._enableWarmup = options.enableWarmup ?? true;
    this._warmupDuration = options.warmupDuration ?? 200;
    this._skipStartupFrames = options.skipStartupFrames ?? 5;
    this.performanceMode = options.performanceMode ?? 'high_quality';
  }

  protected getLogPrefix(): string {
    return '[Sokuji] [ModernAudioRecorder]';
  }

  protected shouldConnectToDestination(): boolean {
    return false; // Speaker audio is muted (not played back)
  }

  /**
   * Get audio constraints based on performance mode
   */
  private getAudioConstraints(deviceId?: string): MediaTrackConstraints {
    const baseConstraints: MediaTrackConstraints = {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      sampleRate: this.sampleRate,
      channelCount: 1,
    };

    const profileName = this.performanceMode.toUpperCase().replace(' ', '_') as keyof typeof AUDIO_CONSTRAINT_PROFILES;
    const profile = AUDIO_CONSTRAINT_PROFILES[profileName] || AUDIO_CONSTRAINT_PROFILES.HIGH_QUALITY;

    return { ...baseConstraints, ...profile };
  }

  /**
   * Get supported MIME type for MediaRecorder
   */
  private getSupportedMimeType(): string {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/wav'];
    return types.find(type => MediaRecorder.isTypeSupported(type)) || 'audio/webm';
  }

  // ==================== Device Management (Unique) ====================

  /**
   * Sets device change callback
   */
  listenForDeviceChange(callback: ((devices: MediaDeviceInfo[]) => void) | null): boolean {
    if (callback === null && this._deviceChangeCallback) {
      navigator.mediaDevices.removeEventListener('devicechange', this._deviceChangeCallback);
      this._deviceChangeCallback = null;
    } else if (callback !== null) {
      let lastId = 0;
      let lastDevices: MediaDeviceInfo[] = [];
      const serializeDevices = (devices: MediaDeviceInfo[]) =>
        devices.map(d => d.deviceId).sort().join(',');

      const cb = async () => {
        const id = ++lastId;
        const devices = await this.listDevices();
        if (id === lastId && serializeDevices(lastDevices) !== serializeDevices(devices)) {
          lastDevices = devices;
          callback(devices.slice());
        }
      };

      navigator.mediaDevices.addEventListener('devicechange', cb);
      cb();
      this._deviceChangeCallback = cb;
    }
    return true;
  }

  /**
   * Request microphone permission
   */
  async requestPermission(): Promise<boolean> {
    const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    if (permissionStatus.state === 'denied') {
      window.alert('You must grant microphone access to use this feature.');
    } else if (permissionStatus.state === 'prompt') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      } catch {
        window.alert('You must grant microphone access to use this feature.');
      }
    }
    return true;
  }

  /**
   * List all eligible audio input devices
   */
  async listDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      throw new Error('Could not request user devices');
    }
    await this.requestPermission();
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioDevices = devices.filter(device => device.kind === 'audioinput');

    const defaultIndex = audioDevices.findIndex(d => d.deviceId === 'default');
    if (defaultIndex !== -1) {
      const defaultDevice = audioDevices.splice(defaultIndex, 1)[0];
      const existingIndex = audioDevices.findIndex(d => d.groupId === defaultDevice.groupId);
      if (existingIndex !== -1) {
        const existing = audioDevices.splice(existingIndex, 1)[0];
        return [existing, ...audioDevices];
      }
      return [defaultDevice, ...audioDevices];
    }
    return audioDevices;
  }

  // ==================== Passthrough (Unique) ====================

  /**
   * Setup passthrough functionality
   */
  setupPassthrough(enabled = false, volume = 0.3): boolean {
    this._passthroughEnabled = enabled;
    this._passthroughVolume = Math.max(0, Math.min(1, volume));
    console.debug(`${this.getLogPrefix()} Passthrough setup: enabled=${enabled}, volume=${this._passthroughVolume}`);
    return true;
  }

  // ==================== Recording Lifecycle ====================

  /**
   * Begin recording session
   */
  async begin(deviceId?: string): Promise<boolean> {
    if (this.mediaRecorder) {
      throw new Error(`${this.getLogPrefix()}: Already connected: please call .end() to start over`);
    }

    try {
      // Acquire stream with echo cancellation
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: this.getAudioConstraints(deviceId)
      });

      const track = this.stream.getAudioTracks()[0];
      const settings = track.getSettings();
      console.info(`${this.getLogPrefix()} Echo cancellation:`, settings.echoCancellation);

      // Create AudioContext
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Setup audio processing with warmup support
      await this.setupRealtimeAudioProcessingWithWarmup();

      // Setup MediaRecorder
      const mimeType = this.getSupportedMimeType();
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        audioBitsPerSecond: 128000
      });
      this.setupMediaRecorderEvents();

      return true;
    } catch (err) {
      console.error(`${this.getLogPrefix()} Could not start audio recording`, err);
      return false;
    }
  }

  /**
   * Setup real-time audio processing with warmup support
   * Override base class to add warmup functionality
   */
  private async setupRealtimeAudioProcessingWithWarmup(): Promise<void> {
    if (!this.audioContext || !this.stream) {
      throw new Error('AudioContext and stream required');
    }

    this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.stream);
    this.useAudioWorklet = this.isAudioWorkletSupported();

    if (this.useAudioWorklet) {
      try {
        console.info(`${this.getLogPrefix()} Using AudioWorklet`);
        const workletUrl = this.getAudioWorkletProcessorUrl();
        await this.audioContext.audioWorklet.addModule(workletUrl);

        // Warmup on first use
        if (this._isFirstRecording && this._enableWarmup) {
          console.info(`${this.getLogPrefix()} Warming up AudioWorklet...`);
          await this._warmupAudioWorklet();
        }

        this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'audio-recorder-processor');

        // Configure skip frames
        this.audioWorkletNode.port.postMessage({
          type: 'config',
          config: { skipStartupFrames: this._skipStartupFrames }
        });

        // Handle messages with silence detection
        this.audioWorkletNode.port.onmessage = (event) => {
          if (event.data.type === 'audioData') {
            const { pcmData } = event.data;

            if (DEBUG_CONFIG.ENABLE_AUDIO_CHUNK_LOGGING) {
              this._audioChunkCount++;
              if (this._audioChunkCount % DEBUG_CONFIG.AUDIO_CHUNK_LOG_INTERVAL === 0) {
                console.debug(`${this.getLogPrefix()} AudioWorklet chunk ${this._audioChunkCount}`);
              }
            }

            // Handle silence detection on first recording
            if (this._isFirstRecording && this._detectSilence(pcmData)) {
              if (this._lastValidAudioChunk) {
                this._processAudioData(this._interpolateAudio(this._lastValidAudioChunk, pcmData));
                return;
              }
            } else {
              this._lastValidAudioChunk = pcmData;
            }

            this._processAudioData(pcmData);
          }
        };

        this.mediaStreamSource.connect(this.audioWorkletNode);
        this.dummyGain = this.audioContext.createGain();
        this.dummyGain.gain.value = 0;
        this.audioWorkletNode.connect(this.dummyGain);
        this.dummyGain.connect(this.audioContext.destination);

      } catch (error) {
        console.warn(`${this.getLogPrefix()} AudioWorklet failed, using ScriptProcessor:`, error);
        this.useAudioWorklet = false;
        await this.setupScriptProcessorFallback();
      }
    } else {
      console.info(`${this.getLogPrefix()} Using ScriptProcessor fallback`);
      await this.setupScriptProcessorFallback();
    }
  }

  /**
   * Start recording
   */
  async record(chunkProcessor: (data: AudioDataWithMeta) => void = () => {}, chunkSize = 100): Promise<boolean> {
    if (!this.mediaRecorder) {
      throw new Error('Session ended: please call .begin() first');
    }
    if (this.recording) {
      throw new Error('Already recording: please call .pause() first');
    }

    this.onAudioData = (data) => {
      chunkProcessor({
        ...data,
        isRecording: this.recording,
        isPassthrough: this._passthroughEnabled,
        passthroughVolume: this._passthroughVolume
      });
    };
    this.audioChunks = [];

    console.info(`${this.getLogPrefix()} Recording started`);

    if (this._isFirstRecording && this.useAudioWorklet) {
      this.mediaRecorder.start(chunkSize);
      this.recording = true;
      await new Promise(resolve => setTimeout(resolve, 100));
      this.audioWorkletNode?.port.postMessage({ type: 'start' });
      this._isFirstRecording = false;
    } else {
      this.mediaRecorder.start(chunkSize);
      this.recording = true;
      this.audioWorkletNode?.port.postMessage({ type: 'start' });
    }

    return true;
  }

  /**
   * Pause recording
   */
  async pause(): Promise<boolean> {
    if (!this.mediaRecorder) {
      throw new Error('Session ended: please call .begin() first');
    }
    if (!this.recording) {
      throw new Error('Already paused: please call .record() first');
    }

    console.info(`${this.getLogPrefix()} Pausing recording`);
    this.audioWorkletNode?.port.postMessage({ type: 'stop' });

    if (this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
      setTimeout(() => {
        if (this.mediaRecorder?.state === 'inactive') {
          this.setupMediaRecorderEvents();
        }
      }, 100);
    }

    this.recording = false;
    return true;
  }

  /**
   * End recording session
   */
  async end(): Promise<{ blob: Blob; url: string }> {
    if (!this.mediaRecorder) {
      throw new Error('Session ended: please call .begin() first');
    }

    console.info(`${this.getLogPrefix()} Stopping recording session`);

    if (this.recording) {
      await this.pause();
    }

    let savedAudio: { blob: Blob; url: string } | null = null;
    try {
      if (this.audioChunks.length > 0) {
        savedAudio = await this.save(true);
      }
    } catch {
      savedAudio = { blob: new Blob([], { type: 'audio/webm' }), url: '' };
    }

    // Cleanup analyser
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    // Base cleanup
    await this.cleanup();

    this.mediaRecorder = null;

    return savedAudio || { blob: new Blob([], { type: 'audio/webm' }), url: '' };
  }

  /**
   * Perform cleanup
   */
  async quit(): Promise<boolean> {
    this.listenForDeviceChange(null);
    if (this.mediaRecorder) {
      await this.end();
    }
    return true;
  }

  // ==================== MediaRecorder (Unique) ====================

  private setupMediaRecorderEvents(): void {
    if (!this.mediaRecorder) return;

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };
    this.mediaRecorder.onstart = () => console.debug(`${this.getLogPrefix()} MediaRecorder started`);
    this.mediaRecorder.onstop = () => console.debug(`${this.getLogPrefix()} MediaRecorder stopped`);
    this.mediaRecorder.onerror = (event) => console.error(`${this.getLogPrefix()} MediaRecorder error:`, event);
  }

  async clear(): Promise<boolean> {
    if (!this.mediaRecorder) {
      throw new Error('Session ended: please call .begin() first');
    }
    this.audioChunks = [];
    return true;
  }

  async read(): Promise<{ meanValues: Float32Array; channels: Float32Array[] }> {
    console.warn(`${this.getLogPrefix()} Read operation not supported`);
    return { meanValues: new Float32Array(0), channels: [] };
  }

  async save(force = false): Promise<{ blob: Blob; url: string }> {
    if (!this.mediaRecorder) {
      throw new Error('Session ended: please call .begin() first');
    }
    if (!force && this.recording) {
      throw new Error('Currently recording: please call .pause() first');
    }
    if (this.audioChunks.length === 0) {
      throw new Error('No audio data to save');
    }

    const mimeType = this.getSupportedMimeType();
    const blob = new Blob(this.audioChunks, { type: mimeType });
    return { blob, url: URL.createObjectURL(blob) };
  }

  // ==================== Frequency Analysis (Unique) ====================

  getFrequencies(
    analysisType: 'frequency' | 'music' | 'voice' = 'frequency',
    minDecibels = -100,
    maxDecibels = -30
  ): { values: Float32Array; peaks: number[] } {
    if (!this.audioContext || !this.mediaStreamSource || !this.recording) {
      return { values: new Float32Array(1024), peaks: [] };
    }

    if (!this.analyser) {
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.minDecibels = minDecibels;
      this.analyser.maxDecibels = maxDecibels;
      this.mediaStreamSource.connect(this.analyser);
    }

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);

    const result = new Float32Array(bufferLength);
    for (let i = 0; i < bufferLength; i++) {
      result[i] = dataArray[i] / 255.0;
    }

    // Filter by analysis type
    const binWidth = this.sampleRate / 2048;
    if (analysisType === 'voice') {
      return { values: result.slice(Math.floor(85 / binWidth), Math.floor(2000 / binWidth)), peaks: [] };
    } else if (analysisType === 'music') {
      return { values: result.slice(Math.floor(20 / binWidth), Math.floor(4000 / binWidth)), peaks: [] };
    }
    return { values: result, peaks: [] };
  }

  // ==================== Warmup & Silence Detection (Unique) ====================

  private async _warmupAudioWorklet(): Promise<void> {
    if (!this.audioContext || !this.stream) return;

    const tempSource = this.audioContext.createMediaStreamSource(this.stream);
    const tempWorklet = new AudioWorkletNode(this.audioContext, 'audio-recorder-processor');
    const tempGain = this.audioContext.createGain();
    tempGain.gain.value = 0;

    tempSource.connect(tempWorklet);
    tempWorklet.connect(tempGain);
    tempGain.connect(this.audioContext.destination);
    tempWorklet.port.onmessage = () => {}; // Discard warmup data

    await new Promise(resolve => setTimeout(resolve, this._warmupDuration));

    tempSource.disconnect();
    tempWorklet.disconnect();
    tempGain.disconnect();
    tempWorklet.port.close();

    console.info(`${this.getLogPrefix()} AudioWorklet warmup complete`);
  }

  private _detectSilence(audioData: Int16Array, threshold = 0.001): boolean {
    if (!audioData?.length) return true;
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += Math.abs(audioData[i] / 32768);
    }
    return sum / audioData.length < threshold;
  }

  private _interpolateAudio(lastChunk: Int16Array, currentChunk: Int16Array): Int16Array {
    const result = new Int16Array(currentChunk.length);
    const fadeLength = Math.min(32, currentChunk.length);

    for (let i = 0; i < currentChunk.length; i++) {
      if (i < fadeLength && lastChunk.length > fadeLength) {
        const ratio = i / fadeLength;
        const lastIndex = lastChunk.length - fadeLength + i;
        result[i] = Math.round(lastChunk[lastIndex] * (1 - ratio));
      } else {
        result[i] = 0;
      }
    }
    return result;
  }

  // ==================== Override getStatus ====================

  getStatus(): 'ended' | 'paused' | 'recording' {
    if (!this.mediaRecorder) {
      return 'ended';
    } else if (!this.recording) {
      return 'paused';
    } else {
      return 'recording';
    }
  }
}

// Global compatibility - use type alias to avoid circular reference
type ModernAudioRecorderClass = typeof import('./ModernAudioRecorder').ModernAudioRecorder;
declare global {
  var ModernAudioRecorder: ModernAudioRecorderClass;
}
(globalThis as Record<string, unknown>).ModernAudioRecorder = ModernAudioRecorder;
