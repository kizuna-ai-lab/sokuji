/**
 * The microphone as the speaker's source (spec: "Capture belongs to the
 * runner"): `ModernAudioRecorder` — 48 kHz capture, RNNoise / GTCRN, 24 kHz
 * chunks — opened on the selected device, following the device and the noise
 * suppression during the run (today's `switchRecordingDevice` and MainPanel's
 * noise-suppression effect). When its device goes away it reopens it, follows
 * the store's next choice, or waits for one (spec 2026-10-04 §2, #593); only
 * `stop()`, or a failure that is not about a device, ends it.
 */
import { SAMPLE_RATE } from '../../contract/adapter';
import { describeCause, reportWarning } from '../../diagnostics/report';
import { ModernAudioRecorder } from '../../modern-audio/ModernAudioRecorder';
import type { Source } from '../../session/source';
import { createSourceCore } from './core';

/** The notices the microphone raises when its device changes under it (#593; spec 2026-10-04 §3). */
export const MIC_LOST_USING_OTHER = 'mic_lost_using_other';
export const MIC_LOST_WAITING = 'mic_lost_waiting';
export const MIC_NOW_USING = 'mic_now_using';

export type NoiseSuppression = 'off' | 'standard' | 'enhanced';

/** The settings a microphone follows, read live. */
export interface MicSettings {
  /** The selected device; undefined while none is, and the source waits for one. */
  deviceId(): string | undefined;
  /** The selected device's name, for the notices. */
  deviceLabel(): string | undefined;
  /** Whether the OS still lists the device. */
  isListed(deviceId: string): boolean;
  /** The device would not open: the store leaves it out and chooses again (spec 2026-10-04 §2). */
  markUnusable(deviceId: string): void;
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
  /** The open device's name, kept from when it opened: a device that went away can no longer be looked up. */
  let label = settings.deviceLabel() ?? deviceId ?? '';
  let mode = settings.noiseSuppression();
  /** Whether the recorder has begun and not ended: only then is there anything to end. */
  let open = false;
  /** Which `begin` the watched track belongs to: a late `ended` from an earlier stream is ignored. */
  let generation = 0;
  /** The name of a device that went away, until the notice that says where the microphone went next. */
  let lost: string | null = null;
  /** On a fallback, or waiting: the next device the source opens gets a "now using" notice. */
  let displaced = false;
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

  /** Steps run one at a time, in order: a switch, a lost track, a noise-mode change. A failure not about a device ends the source. */
  const queue = (step: () => Promise<void>) => {
    chain = chain
      .then(step)
      .catch((error: unknown) => core.end(`The microphone failed: ${describeCause(error)}`));
  };

  const begin = async () => {
    if (!(await recorder.begin(deviceId))) throw new Error('The microphone could not be opened. Reload the page and try again.');
    open = true;
    label = settings.deviceLabel() ?? deviceId ?? '';
    const mine = ++generation;
    unwatch = core.watch(recorder.getStream(), () => queue(() => trackEnded(mine)));
    await recorder.record((data) => core.deliver(data.mono));
  };

  const notice = (code: string, message: string, params: Record<string, string>, severity: 'warning' | 'info' = 'warning') =>
    core.degrade({ code, message, params, severity });

  /** Opens `next` (or waits, for none) and says where the microphone went, when it went there because of a loss. */
  const switchTo = async (next: string | undefined) => {
    deviceId = next;
    await close();
    if (core.stopped) return;
    if (next === undefined) {
      if (lost !== null) {
        notice(MIC_LOST_WAITING, `The microphone "${lost}" went away; waiting for one to be connected.`, { lost });
        lost = null;
        displaced = true;
      }
      return;
    }
    try {
      await begin();
    } catch {
      // This device will not open: the store leaves it out and selects the
      // next one, which `follow` then opens. The failed one is reported as the
      // device that went away, unless one already did.
      lost ??= settings.deviceLabel() ?? next;
      settings.markUnusable(next);
      return;
    }
    if (lost !== null) {
      notice(MIC_LOST_USING_OTHER, `The microphone "${lost}" went away; using "${label}" instead.`, { lost, device: label });
      lost = null;
      displaced = true;
    } else if (displaced) {
      notice(MIC_NOW_USING, `Now using the microphone "${label}".`, { device: label }, 'info');
      displaced = false;
    }
  };

  /** The store's settings changed: follow the noise mode and the device. */
  const follow = async () => {
    if (core.stopped || core.ended) return;
    const nextMode = settings.noiseSuppression();
    if (nextMode !== mode) {
      mode = nextMode;
      await recorder.setNoiseSuppressionMode(mode);
    }
    const next = settings.deviceId();
    if (next === deviceId && (open || next === undefined)) return;
    // A move off a device the OS no longer lists is a loss, whether the sync
    // or the track's `ended` got here first.
    if (open && deviceId !== undefined && !settings.isListed(deviceId)) lost ??= label;
    await switchTo(next);
  };

  /** The open device's track ended: reopen it if it is still there, else let the store choose again. */
  const trackEnded = async (which: number) => {
    if (core.stopped || core.ended || which !== generation || !open) return;
    const gone = deviceId as string;
    lost ??= label;
    // The sync handled `devicechange` first and already chose another device.
    if (settings.deviceId() !== gone) {
      await switchTo(settings.deviceId());
      return;
    }
    await close();
    if (core.stopped) return;
    try {
      await begin();
      // A blip: the same device opened again, nothing to tell.
      lost = null;
    } catch {
      settings.markUnusable(gone);
    }
  };

  if (deviceId === undefined) {
    await core.stop();
    throw new Error('No microphone is selected. Choose one in Settings and try again.');
  }
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

  unsubscribe = settings.subscribe(() => queue(follow));
  return core;
}
