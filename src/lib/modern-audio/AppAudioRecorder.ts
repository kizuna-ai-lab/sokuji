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
   * No AudioContext exists on this path - the PCM goes straight to the client -
   * so there is no analyser to hand out and the participant waveform stays flat.
   * Audio and translation are unaffected.
   */
  getAnalyser(): AnalyserNode | null {
    return null;
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

    this.callback = null;
    this.leftover = new Uint8Array(0);
    this.status = 'ended';
  }

  private onPcm(payload: Uint8Array): void {
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

    this.callback({ mono, raw: mono });
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
