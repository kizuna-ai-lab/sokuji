/**
 * The microphone as the speaker's source (spec: "Capture belongs to the
 * runner"): `ModernAudioRecorder` — 48 kHz capture, RNNoise / GTCRN, 24 kHz
 * chunks — opened on the selected device, following the device and the noise
 * suppression during the run (today's `switchRecordingDevice` and MainPanel's
 * noise-suppression effect).
 */
import { SAMPLE_RATE } from '../../contract/adapter';
import { describeCause, reportWarning } from '../../diagnostics/report';
import { ModernAudioRecorder } from '../../modern-audio/ModernAudioRecorder';
import type { Source } from '../../session/source';
import { createSourceCore } from './core';

export type NoiseSuppression = 'off' | 'standard' | 'enhanced';

/** The settings a microphone follows, read live. */
export interface MicSettings {
  deviceId(): string | undefined;
  noiseSuppression(): NoiseSuppression;
  muted(): boolean;
  /** Called when any of them may have changed. */
  subscribe(listener: () => void): () => void;
}

/** The part of `ModernAudioRecorder` a microphone drives. */
export interface MicRecorder {
  /** Throws a `MicrophoneCaptureError` whose message says what to do. */
  begin(deviceId?: string): Promise<boolean>;
  record(chunk: (data: { mono: Int16Array }) => void): Promise<boolean>;
  /** Ends the recording, keeping the recorder (and its GTCRN worker) alive for reuse on the next `begin()`. */
  end(): Promise<unknown>;
  /** Ends the recording if it is open, then disposes the recorder for good — the GTCRN worker included. */
  quit(): Promise<unknown>;
  setNoiseSuppressionMode(mode: NoiseSuppression): Promise<void>;
  getStream(): MediaStream | null;
}

export async function openMic(
  settings: MicSettings,
  signal: AbortSignal,
  createRecorder: () => MicRecorder = () => new ModernAudioRecorder({ sampleRate: SAMPLE_RATE }),
): Promise<Source> {
  const recorder = createRecorder();
  let deviceId = settings.deviceId();
  let mode = settings.noiseSuppression();
  /** Whether the recorder has begun and not ended: only then is there anything to end. */
  let open = false;
  let unwatch = () => {};
  let unsubscribe = () => {};
  let chain: Promise<void> = Promise.resolve();

  const close = async () => {
    unwatch();
    unwatch = () => {};
    if (!open) return;
    open = false;
    await recorder.end();
  };

  const core = createSourceCore({
    muted: () => settings.muted(),
    track: () => recorder.getStream()?.getAudioTracks()[0],
    release: async () => {
      // `Source.stop` stops capturing before its first `await` (roadmap 1e-1): a
      // `pagehide` never awaits this, and a device switch in flight must not keep
      // the microphone open while it settles. `quit()` below still ends the recorder.
      for (const track of recorder.getStream()?.getTracks() ?? []) track.stop();
      unsubscribe();
      // A switch in flight finishes (or fails) before the recorder is disposed.
      await chain;
      unwatch();
      unwatch = () => {};
      open = false;
      // `quit()`, not `end()`: this recorder is not reused after this, so its GTCRN
      // worker (kept alive across `end()` for the device switch above) must go too.
      try {
        await recorder.quit();
      } catch (error) {
        reportWarning('Microphone', `Stopping the microphone failed: ${describeCause(error)}`, { dedupeKey: 'mic:end' });
      }
    },
  });

  const begin = async () => {
    if (!(await recorder.begin(deviceId))) throw new Error('The microphone could not be opened. Reload the page and try again.');
    open = true;
    unwatch = core.watch(recorder.getStream());
    await recorder.record((data) => core.deliver(data.mono));
  };

  // Recorded now and applied when `begin` builds the graph.
  await recorder.setNoiseSuppressionMode(mode);
  try {
    await begin();
  } catch (error) {
    await core.stop();
    throw error;
  }
  if (signal.aborted) {
    await core.stop();
    throw signal.reason ?? new Error('aborted');
  }

  unsubscribe = settings.subscribe(() => {
    chain = chain
      .then(async () => {
        if (core.stopped || core.ended) return;
        const nextMode = settings.noiseSuppression();
        if (nextMode !== mode) {
          mode = nextMode;
          await recorder.setNoiseSuppressionMode(mode);
        }
        const nextDevice = settings.deviceId();
        if (nextDevice === deviceId) return;
        deviceId = nextDevice;
        await close();
        if (core.stopped) return;
        await begin();
      })
      .catch((error: unknown) => core.end(`The microphone could not switch: ${describeCause(error)}`));
  });
  return core;
}
