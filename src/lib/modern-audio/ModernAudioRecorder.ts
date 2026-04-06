import { BaseAudioRecorder } from './BaseAudioRecorder';
import { DEBUG_CONFIG, AUDIO_CONSTRAINT_PROFILES } from '../config/performance.js';

// Vite ?url imports for AudioWorklet and WASM assets
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

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

  // Noise suppression (AudioWorklet-based via @sapphi-red/web-noise-suppressor)
  private rnnoiseNode: (AudioWorkletNode & { destroy(): void }) | null = null;
  private rnnoiseWasmBinary: ArrayBuffer | null = null;
  private rnnoiseModuleLoaded: boolean = false;
  private _noiseSuppressEnabled: boolean = false;
  private _noiseSuppressOpId: number = 0;

  // GTCRN worker-based noise suppression
  private gtcrnWorker: Worker | null = null;
  private gtcrnReady: boolean = false;
  private _noiseSuppressionMode: 'off' | 'standard' | 'enhanced' = 'off';
  private _originalOnMessage: ((event: MessageEvent) => void) | null = null;

  // Internal sample rate for AudioContext (48kHz for RNNoise compatibility)
  private internalSampleRate: number;

  constructor(options: ModernAudioRecorderOptions = {}) {
    super(options.sampleRate ?? 24000);
    this.internalSampleRate = 48000;

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
      sampleRate: this.internalSampleRate,
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

      // Create AudioContext at 48kHz for RNNoise compatibility
      this.audioContext = new AudioContext({ sampleRate: this.internalSampleRate });
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

        // Handle messages with noise suppression and downsampling
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
            let processedPcm: Int16Array = pcmData;
            if (this._isFirstRecording && this._detectSilence(pcmData)) {
              if (this._lastValidAudioChunk) {
                processedPcm = this._interpolateAudio(this._lastValidAudioChunk, pcmData);
              }
            } else {
              this._lastValidAudioChunk = pcmData;
            }

            // Downsample 48kHz → 24kHz for client compatibility
            const outputPcm = this.downsample48to24(processedPcm);
            this._processAudioData(outputPcm);
          }
        };

        this.mediaStreamSource.connect(this.audioWorkletNode);
        this.dummyGain = this.audioContext.createGain();
        this.dummyGain.gain.value = 0;
        this.audioWorkletNode.connect(this.dummyGain);
        this.dummyGain.connect(this.audioContext.destination);

        // Insert noise suppression based on current mode
        if (this._noiseSuppressionMode === 'standard') {
          await this._insertRnnoiseNode();
        } else if (this._noiseSuppressionMode === 'enhanced') {
          await this._connectGtcrnWorker();
        }

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

    // Cleanup RNNoise node
    if (this.rnnoiseNode) {
      this.rnnoiseNode.disconnect();
      this.rnnoiseNode.destroy();
      this.rnnoiseNode = null;
    }
    this.rnnoiseModuleLoaded = false; // AudioContext will be closed

    // Cleanup GTCRN worker connection (keep worker alive for reuse)
    this._disconnectGtcrnWorker();

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
    this._disposeGtcrnWorker();
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
      // Connect analyser to post-suppression audio if available, otherwise raw
      if (this.rnnoiseNode) {
        this.rnnoiseNode.connect(this.analyser);
      } else {
        this.mediaStreamSource.connect(this.analyser);
      }
    }

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);

    const result = new Float32Array(bufferLength);
    for (let i = 0; i < bufferLength; i++) {
      result[i] = dataArray[i] / 255.0;
    }

    // Filter by analysis type
    const binWidth = this.internalSampleRate / 2048;
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

  // ==================== Noise Suppression ====================

  /**
   * Enable or disable AudioWorklet-based noise suppression.
   * Dynamically inserts/removes RnnoiseWorkletNode in the audio graph.
   */
  async setNoiseSuppressionEnabled(enabled: boolean): Promise<void> {
    await this.setNoiseSuppressionMode(enabled ? 'standard' : 'off');
  }

  /**
   * Set noise suppression mode: 'off', 'standard' (RNNoise), or 'enhanced' (GTCRN).
   */
  async setNoiseSuppressionMode(mode: 'off' | 'standard' | 'enhanced'): Promise<void> {
    const prevMode = this._noiseSuppressionMode;
    this._noiseSuppressionMode = mode;
    this._noiseSuppressEnabled = mode === 'standard';
    const opId = ++this._noiseSuppressOpId;

    if (!this.audioContext || !this.mediaStreamSource || !this.audioWorkletNode) {
      return;
    }

    // Tear down previous mode
    if (prevMode === 'standard' && mode !== 'standard') {
      this._removeRnnoiseNode();
    }
    if (prevMode === 'enhanced' && mode !== 'enhanced') {
      this._disconnectGtcrnWorker();
    }

    // Set up new mode
    if (mode === 'standard') {
      await this._insertRnnoiseNode(opId);
    } else if (mode === 'enhanced') {
      await this._connectGtcrnWorker(opId);
    }
  }

  /**
   * Lazy-load the RNNoise WASM binary via dynamic import.
   */
  private async _loadRnnoiseResources(): Promise<ArrayBuffer> {
    if (this.rnnoiseWasmBinary) return this.rnnoiseWasmBinary;

    const { loadRnnoise } = await import('@sapphi-red/web-noise-suppressor');
    this.rnnoiseWasmBinary = await loadRnnoise({
      url: rnnoiseWasmPath,
      simdUrl: rnnoiseSimdWasmPath,
    });
    return this.rnnoiseWasmBinary;
  }

  /**
   * Lazy-register the RNNoise AudioWorklet processor module.
   */
  private async _ensureRnnoiseModule(): Promise<void> {
    if (this.rnnoiseModuleLoaded) return;
    if (!this.audioContext) throw new Error('AudioContext required');

    await this.audioContext.audioWorklet.addModule(rnnoiseWorkletPath);
    this.rnnoiseModuleLoaded = true;
  }

  /**
   * Insert RnnoiseWorkletNode between mediaStreamSource and audioWorkletNode.
   * Also reconnects the analyser to tap post-suppression audio.
   */
  private async _insertRnnoiseNode(opId?: number): Promise<void> {
    if (this.rnnoiseNode) return; // Already inserted
    if (!this.audioContext || !this.mediaStreamSource || !this.audioWorkletNode) return;

    try {
      const [wasmBinary] = await Promise.all([
        this._loadRnnoiseResources(),
        this._ensureRnnoiseModule(),
      ]);

      // Abort if a newer toggle happened during async loading
      if (opId !== undefined && opId !== this._noiseSuppressOpId) {
        console.debug(`${this.getLogPrefix()} RNNoise insert aborted (stale opId ${opId} vs ${this._noiseSuppressOpId})`);
        return;
      }

      const { RnnoiseWorkletNode } = await import('@sapphi-red/web-noise-suppressor');
      this.rnnoiseNode = new RnnoiseWorkletNode(this.audioContext, {
        wasmBinary,
        maxChannels: 1,
      });

      // Rewire: mediaStreamSource → rnnoiseNode → audioWorkletNode
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource.connect(this.rnnoiseNode);
      this.rnnoiseNode.connect(this.audioWorkletNode);

      // Reconnect analyser to post-suppression audio if it exists
      if (this.analyser) {
        try { this.analyser.disconnect(); } catch { /* ignore */ }
        this.rnnoiseNode.connect(this.analyser);
      }

      console.info(`${this.getLogPrefix()} RNNoise worklet node inserted`);
    } catch (error) {
      console.error(`${this.getLogPrefix()} Failed to insert RNNoise node:`, error);
      this.rnnoiseNode = null;
      // Restore direct connection so mic audio is not lost
      try {
        if (this.mediaStreamSource && this.audioWorkletNode) {
          this.mediaStreamSource.connect(this.audioWorkletNode);
          if (this.analyser) {
            this.mediaStreamSource.connect(this.analyser);
          }
        }
      } catch { /* best effort */ }
    }
  }

  /**
   * Remove RnnoiseWorkletNode and restore direct connection.
   */
  private _removeRnnoiseNode(): void {
    if (!this.rnnoiseNode || !this.mediaStreamSource || !this.audioWorkletNode) return;

    try {
      this.mediaStreamSource.disconnect();
      this.rnnoiseNode.disconnect();
      this.rnnoiseNode.destroy();
      this.rnnoiseNode = null;

      // Restore: mediaStreamSource → audioWorkletNode
      this.mediaStreamSource.connect(this.audioWorkletNode);

      // Reconnect analyser to raw audio if it exists
      if (this.analyser) {
        try { this.analyser.disconnect(); } catch { /* ignore */ }
        this.mediaStreamSource.connect(this.analyser);
      }

      console.info(`${this.getLogPrefix()} RNNoise worklet node removed`);
    } catch (error) {
      console.error(`${this.getLogPrefix()} Failed to remove RNNoise node:`, error);
      // Ensure direct connection is restored so mic audio is not lost
      try {
        if (this.mediaStreamSource && this.audioWorkletNode) {
          this.mediaStreamSource.connect(this.audioWorkletNode);
          if (this.analyser) {
            this.mediaStreamSource.connect(this.analyser);
          }
        }
      } catch { /* best effort */ }
    }
  }

  /**
   * Initialize and connect GTCRN worker for audio processing.
   */
  private async _connectGtcrnWorker(opId?: number): Promise<void> {
    if (!this.audioWorkletNode) return;

    try {
      if (!this.gtcrnWorker) {
        this.gtcrnWorker = new Worker(
          new URL('./gtcrn/gtcrn-worker.ts', import.meta.url),
          { type: 'module' }
        );

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('GTCRN worker init timeout')), 10000);
          this.gtcrnWorker!.onmessage = (event) => {
            if (event.data.type === 'ready') {
              clearTimeout(timeout);
              this.gtcrnReady = true;
              resolve();
            } else if (event.data.type === 'error') {
              clearTimeout(timeout);
              reject(new Error(event.data.message));
            }
          };
          this.gtcrnWorker!.postMessage({
            type: 'init',
            ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
            modelUrl: new URL('./wasm/gtcrn/gtcrn_simple.onnx', window.location.href).href,
          });
        });
      }

      if (opId !== undefined && opId !== this._noiseSuppressOpId) return;

      const originalHandler = this.audioWorkletNode.port.onmessage;
      this._originalOnMessage = originalHandler as ((event: MessageEvent) => void) | null;

      this.gtcrnWorker.onmessage = (event: MessageEvent) => {
        if (event.data.type === 'audio') {
          const denoisedPcm: Int16Array = event.data.audio;
          const outputPcm = this.downsample48to24(denoisedPcm);
          this._processAudioData(outputPcm);
        } else if (event.data.type === 'error') {
          console.error(`${this.getLogPrefix()} GTCRN worker error:`, event.data.message);
          this.setNoiseSuppressionMode('standard');
        }
      };

      this.audioWorkletNode.port.onmessage = (event: MessageEvent) => {
        if (event.data.type === 'audioData' && this.gtcrnReady && this.gtcrnWorker) {
          const { pcmData } = event.data;
          this.gtcrnWorker.postMessage(
            { type: 'process', audio: pcmData },
            [pcmData.buffer]
          );
        }
      };

      console.info(`${this.getLogPrefix()} GTCRN worker connected`);
    } catch (error) {
      console.error(`${this.getLogPrefix()} Failed to connect GTCRN worker:`, error);
      this.gtcrnReady = false;
      this._noiseSuppressionMode = 'standard';
      this._noiseSuppressEnabled = true;
      await this._insertRnnoiseNode();
    }
  }

  /**
   * Disconnect GTCRN worker from the audio pipeline (keep worker alive).
   */
  private _disconnectGtcrnWorker(): void {
    if (!this.audioWorkletNode) return;

    if (this._originalOnMessage) {
      this.audioWorkletNode.port.onmessage = this._originalOnMessage;
      this._originalOnMessage = null;
    }

    if (this.gtcrnWorker) {
      this.gtcrnWorker.postMessage({ type: 'reset' });
    }

    console.info(`${this.getLogPrefix()} GTCRN worker disconnected`);
  }

  /**
   * Fully dispose the GTCRN worker.
   */
  private _disposeGtcrnWorker(): void {
    this._disconnectGtcrnWorker();
    if (this.gtcrnWorker) {
      this.gtcrnWorker.postMessage({ type: 'dispose' });
      this.gtcrnWorker.terminate();
      this.gtcrnWorker = null;
      this.gtcrnReady = false;
    }
  }

  /**
   * Resample Int16 PCM captured at 48kHz down to the recorder's target sample rate.
   *
   * - If target sample rate is 24kHz (default), uses simple averaging of adjacent
   *   sample pairs (factor of 2) for basic low-pass anti-aliasing.
   * - If target sample rate is 48kHz, returns the input unchanged.
   * - For other target rates below 48kHz, uses linear interpolation with a
   *   fixed-ratio resampling from 48kHz to the configured rate.
   *
   * NOTE: This helper is intended only for downsampling from 48kHz. If a higher
   * target sample rate than 48kHz is configured, the input is returned unchanged.
   */
  private downsample48to24(input: Int16Array): Int16Array {
    const sourceSampleRate = 48000;
    const targetSampleRate = this.sampleRate ?? 24000;

    // Guard against invalid or unsupported target sample rates
    if (!targetSampleRate || targetSampleRate <= 0) {
      // Fallback: return input unchanged
      return input;
    }

    // No resampling needed: target matches source
    if (targetSampleRate === sourceSampleRate) {
      // Return a copy to avoid accidental mutation of the original buffer
      return input.slice();
    }

    // Optimized path for the original 48kHz -> 24kHz behavior (factor of 2)
    if (targetSampleRate === 24000) {
      const outputLength = Math.floor(input.length / 2);
      const output = new Int16Array(outputLength);
      for (let i = 0; i < outputLength; i++) {
        // Average adjacent samples for basic anti-aliasing
        output[i] = (input[i * 2] + input[i * 2 + 1]) >> 1;
      }
      return output;
    }

    // Do not attempt to upsample beyond the capture rate; return input as-is.
    if (targetSampleRate > sourceSampleRate) {
      return input;
    }

    // Generic 48kHz -> targetSampleRate downsampling using linear interpolation
    const ratio = sourceSampleRate / targetSampleRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Int16Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const indexInt = Math.floor(srcIndex);
      const indexFrac = srcIndex - indexInt;

      const i0 = indexInt;
      const i1 = Math.min(i0 + 1, input.length - 1);

      const s0 = input[i0];
      const s1 = input[i1];

      // Linear interpolation between s0 and s1
      const interpolated = s0 + (s1 - s0) * indexFrac;
      output[i] = interpolated < 0
        ? Math.max(interpolated, -32768) | 0
        : Math.min(interpolated, 32767) | 0;
    }
    return output;
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
