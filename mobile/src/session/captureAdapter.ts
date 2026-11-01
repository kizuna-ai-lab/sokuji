import type * as AudioCapture from '../../modules/audio-capture/src/AudioCaptureModule';
import type { CaptureInfo, CaptureOptions } from '../../modules/audio-capture/src/AudioCaptureModule';
import type { Pan, SpeechPlayer } from './speech';

// The session's view of the native capture module, and the module's speech
// functions as a SpeechPlayer. Apart from the wrapper, which is native: the
// node tests give these a fake module.

/** The module's stop and start: resuming re-reports what is running. */
export interface Capture {
  start(): Promise<CaptureInfo>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<CaptureInfo>;
}

export type ModuleSlice = Pick<typeof AudioCapture, 'startCapture' | 'stopCapture' | 'addAudioListener' | 'addStoppedListener'>;

export interface CaptureCallbacks {
  options: CaptureOptions;
  onAudio: (pcm: Int16Array) => void;
  onStopped: (reason: string, message?: string) => void;
}

export function createCaptureAdapter(module: ModuleSlice, o: CaptureCallbacks): Capture {
  let subscriptions: Array<{ remove(): void }> = [];
  const release = () => {
    for (const sub of subscriptions) sub.remove();
    subscriptions = [];
  };
  return {
    async start() {
      // Listening first: the first frame can come before the start settles.
      subscriptions = [module.addAudioListener(o.onAudio), module.addStoppedListener((e) => o.onStopped(e.reason, e.message))];
      try {
        return await module.startCapture(o.options);
      } catch (err) {
        release();
        throw err;
      }
    },
    async stop() {
      release();
      await module.stopCapture();
    },
    pause: () => module.stopCapture(),
    resume: () => module.startCapture(o.options),
  };
}

export type SpeechSlice = Pick<typeof AudioCapture, 'speechOpen' | 'speechWrite' | 'speechStop' | 'speechQueuedSeconds' | 'speechHeld' | 'speechClose'>;

/**
 * The track opens asynchronously and speech may already be on its way: what
 * comes before it is open is held and written in order. A track that cannot
 * open costs the voice, not the session; `onFailed` says why.
 */
export function createModuleSpeechPlayer(module: SpeechSlice, sampleRate: number, onFailed: (message: string) => void): SpeechPlayer & { close(): Promise<void> } {
  let state: 'opening' | 'open' | 'failed' = 'opening';
  let waiting: Array<{ pcm: Int16Array; pan: Pan }> = [];
  const opening = module.speechOpen(sampleRate).then(
    () => {
      state = 'open';
      for (const chunk of waiting) module.speechWrite(chunk.pcm, chunk.pan);
      waiting = [];
    },
    (err: unknown) => {
      state = 'failed';
      waiting = [];
      onFailed(err instanceof Error ? err.message : String(err));
    },
  );
  return {
    play(pcm, pan = 'both') {
      if (state === 'open') module.speechWrite(pcm, pan);
      else if (state === 'opening') waiting.push({ pcm, pan });
    },
    stop() {
      waiting = [];
      if (state === 'open') module.speechStop();
    },
    queuedSeconds() {
      if (state === 'open') return module.speechQueuedSeconds();
      return waiting.reduce((sum, chunk) => sum + chunk.pcm.length, 0) / sampleRate;
    },
    held() {
      return state === 'open' ? module.speechHeld() : waiting.length;
    },
    async close() {
      await opening;
      await module.speechClose();
    },
  };
}
