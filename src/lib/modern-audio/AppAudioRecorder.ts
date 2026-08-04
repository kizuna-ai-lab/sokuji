import {
  IParticipantAudioRecorder,
  ParticipantAudioOptions,
  AudioDataCallback,
} from './IParticipantAudioRecorder';

/**
 * Participant recorder fed by the per-application capture helper (issue #335),
 * used on both Windows and macOS - the two share one CLI contract.
 *
 * The helper already emits exactly 24 kHz mono signed 16-bit PCM, and its
 * stream stays continuous and correctly clocked even while the captured
 * application is silent. This class therefore neither resamples nor inserts
 * silence - it aligns bytes to samples and dispatches.
 *
 * It implements IParticipantAudioRecorder directly instead of extending
 * ParticipantRecorder: that base class is built around acquireStream() returning
 * a MediaStream, and forcing already-decoded PCM through a synthetic MediaStream
 * would add a buffering stage and a pointless conversion round-trip.
 */
export class AppAudioRecorder implements IParticipantAudioRecorder {
  private callback: AudioDataCallback | null = null;
  private status: 'ended' | 'paused' | 'recording' = 'ended';
  private pcmHandler: ((payload: Uint8Array) => void) | null = null;
  private eventHandler: ((payload: { event?: string; code?: string }) => void) | null = null;
  /** A chunk can split a 16-bit sample; the odd byte waits here for its partner. */
  private leftover: Uint8Array = new Uint8Array(0);

  // Rolling level, logged periodically. Silence and a denied permission look
  // identical from the outside, so the console must state which one it is
  // rather than leaving it to be inferred.
  private peakSinceLog = 0;
  private samplesSinceLog = 0;
  private everHeardAudio = false;

  // A Web Audio branch that exists only to drive the waveform: the PCM already
  // went to the client by the time it gets here, and this graph is deliberately
  // never connected to the destination, so it makes no sound.
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private nextPlayTime = 0;
  /** Set once the graph has failed, so one bad chunk cannot spam the console. */
  private analyserBroken = false;

  /**
   * Distinguishes the two ways capture can look broken: PCM arriving but silent,
   * versus no PCM arriving at all. They have different causes - a global tap
   * always delivers buffers, while a per-process tap delivers nothing at all
   * while its target is idle - and the log has to say which one happened.
   */
  private silenceWatchdog: ReturnType<typeof setInterval> | null = null;
  private chunksSeen = 0;

  /** Invoked when the helper dies, so the caller can fall back to system capture. */
  public onLost: (() => void) | null = null;

  /**
   * Invoked for non-fatal helper warnings, carrying the helper's code.
   *
   * The one that matters today is `silent_no_permission`: macOS TCC denies an
   * audio tap by zeroing every sample rather than failing, so without this the
   * user would see a session that runs perfectly and translates nothing.
   */
  public onWarning: ((code: string) => void) | null = null;

  constructor(private readonly sampleRate: number = 24000) {}

  getSampleRate(): number {
    return this.sampleRate;
  }

  getStatus(): 'ended' | 'paused' | 'recording' {
    return this.status;
  }

  /**
   * Analyser over the captured audio, so the participant waveform animates on
   * this path too. Without it a flat waveform gave no way to tell working
   * capture from silent capture.
   */
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  async begin(options?: ParticipantAudioOptions): Promise<boolean> {
    const deviceId = options?.deviceId;
    if (!deviceId) {
      console.error('[Sokuji] [AppAudioRecorder] A deviceId is required for application capture');
      return false;
    }

    const electron = window.electron;
    if (!electron) {
      console.error('[Sokuji] [AppAudioRecorder] Application capture requires Electron');
      return false;
    }

    // Subscribe before starting, or the first PCM chunks are dropped.
    // preload strips the IPC event, so handlers receive the payload directly.
    this.pcmHandler = (payload: Uint8Array) => this.onPcm(payload);
    this.eventHandler = (payload) => this.onHelperEvent(payload);
    electron.receive('app-audio:pcm', this.pcmHandler);
    electron.receive('app-audio:event', this.eventHandler);

    const result = await electron.invoke('start-app-audio-capture', deviceId);
    if (!result?.ok) {
      console.error('[Sokuji] [AppAudioRecorder] Failed to start capture:', result?.error);
      await this.end();
      return false;
    }

    this.status = 'paused';
    this.silenceWatchdog = setInterval(() => {
      if (this.chunksSeen === 0) {
        console.warn(
          '[Sokuji] [AppAudioRecorder] No audio data at all from the helper yet' +
          ' - the target is producing no output (a per-application tap delivers' +
          ' nothing while its application is idle).'
        );
      }
    }, 5000);
    console.info(`[Sokuji] [AppAudioRecorder] Capturing ${deviceId}`);
    return true;
  }

  async record(callback: AudioDataCallback): Promise<boolean> {
    this.callback = callback;
    this.status = 'recording';
    return true;
  }

  async pause(): Promise<boolean> {
    this.status = 'paused';
    return true;
  }

  async end(): Promise<void> {
    const electron = window.electron;

    // removeListener resolves the wrapper from the original function, so it must
    // be handed the exact reference passed to receive().
    if (electron && this.pcmHandler) {
      electron.removeListener('app-audio:pcm', this.pcmHandler);
    }
    if (electron && this.eventHandler) {
      electron.removeListener('app-audio:event', this.eventHandler);
    }
    this.pcmHandler = null;
    this.eventHandler = null;

    try {
      await electron?.invoke('stop-app-audio-capture');
    } catch (error) {
      console.warn('[Sokuji] [AppAudioRecorder] Failed to stop capture:', error);
    }

    if (this.silenceWatchdog) {
      clearInterval(this.silenceWatchdog);
      this.silenceWatchdog = null;
    }
    this.callback = null;
    this.leftover = new Uint8Array(0);
    this.status = 'ended';
    this.analyser = null;
    if (this.audioContext) {
      void this.audioContext.close().catch(() => { /* already closing */ });
      this.audioContext = null;
    }
  }

  private onPcm(payload: Uint8Array): void {
    this.chunksSeen++;
    if (this.status !== 'recording' || !this.callback) return;

    let bytes: Uint8Array = payload;
    if (this.leftover.length > 0) {
      const merged = new Uint8Array(this.leftover.length + payload.length);
      merged.set(this.leftover, 0);
      merged.set(payload, this.leftover.length);
      bytes = merged;
      this.leftover = new Uint8Array(0);
    }

    const usable = bytes.length - (bytes.length % 2);
    if (usable < bytes.length) {
      this.leftover = bytes.slice(usable);
    }
    if (usable === 0) return;

    // Copy into a fresh buffer rather than viewing the incoming one: the view
    // may be unaligned, and consumers transfer (detach) the ArrayBuffer when
    // posting it to a worker.
    const aligned = new Uint8Array(usable);
    aligned.set(bytes.subarray(0, usable));
    const mono = new Int16Array(aligned.buffer);

    // Observe BEFORE dispatching. The callback transfers this ArrayBuffer to a
    // worker, which detaches it and leaves mono.length at 0 - which silently
    // zeroed every level reading and made the analyser ask for a 0-frame buffer
    // on every single chunk.
    this.observeLevel(mono);
    this.feedAnalyser(mono);
    this.callback({ mono, raw: mono });
  }

  /** Log the captured level periodically so silence is visible as a fact. */
  private observeLevel(mono: Int16Array): void {
    if (mono.length === 0) return;
    for (let i = 0; i < mono.length; i++) {
      const a = Math.abs(mono[i]);
      if (a > this.peakSinceLog) this.peakSinceLog = a;
    }
    this.samplesSinceLog += mono.length;

    // 24 kHz, so this is roughly every two seconds.
    if (this.samplesSinceLog < 48000) return;

    const peak = this.peakSinceLog / 32768;
    if (peak > 0.001) this.everHeardAudio = true;
    console.info(
      `[Sokuji] [AppAudioRecorder] captured level: peak=${peak.toFixed(4)}` +
      `${peak <= 0.001 ? ' (silent - the source is not playing, or capture is not permitted)' : ''}`
    );
    this.peakSinceLog = 0;
    this.samplesSinceLog = 0;
  }

  /**
   * Push the PCM through a detached Web Audio graph purely to drive the
   * waveform. Scheduling short buffers back to back keeps the analyser fed
   * without a worklet or a SharedArrayBuffer.
   */
  private feedAnalyser(mono: Int16Array): void {
    if (this.analyserBroken || mono.length === 0) return;
    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.nextPlayTime = this.audioContext.currentTime;
      }
      const ctx = this.audioContext;
      if (ctx.state === 'suspended') void ctx.resume();

      const buffer = ctx.createBuffer(1, mono.length, this.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < mono.length; i++) channel[i] = mono[i] / 32768;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      // Connected to the analyser only - never to ctx.destination, or the
      // captured audio would be played back and fed straight into the capture.
      source.connect(this.analyser!);

      const now = ctx.currentTime;
      if (this.nextPlayTime < now) this.nextPlayTime = now;
      source.start(this.nextPlayTime);
      this.nextPlayTime += buffer.duration;
    } catch (error) {
      // The waveform is cosmetic; never let it break capture - and never let it
      // repeat, since this runs on every chunk about a hundred times a second.
      console.warn('[Sokuji] [AppAudioRecorder] Analyser disabled after:', error);
      this.analyserBroken = true;
      this.analyser = null;
      void this.audioContext?.close().catch(() => { /* already closing */ });
      this.audioContext = null;
    }
  }

  private onHelperEvent(payload: { event?: string; code?: string }): void {
    if (payload?.event === 'format') {
      console.info('[Sokuji] [AppAudioRecorder] Helper format:', payload);
      return;
    }
    if (payload?.event === 'warning') {
      console.warn('[Sokuji] [AppAudioRecorder] Capture helper warning:', payload);
      this.onWarning?.(payload.code ?? 'unknown');
      return;
    }
    if (payload?.event === 'exit' || payload?.event === 'error') {
      console.warn('[Sokuji] [AppAudioRecorder] Capture helper reported:', payload);
      this.onLost?.();
    }
  }
}
