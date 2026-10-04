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
import { MicrophoneCaptureError } from '../../modern-audio/microphoneCaptureError';
import type { Source } from '../../session/source';
import { createSourceCore } from './core';

/** The notices the microphone raises when its device changes under it (#593; spec 2026-10-04 §3). */
export const MIC_LOST_USING_OTHER = 'mic_lost_using_other';
export const MIC_LOST_WAITING = 'mic_lost_waiting';
export const MIC_NOW_USING = 'mic_now_using';

/**
 * A reopened device whose track ends again sooner than this is not a blip but a
 * device that keeps dropping: it is treated as one that will not open.
 */
const REOPEN_HOLD_MS = 5_000;

/**
 * The microphone was refused — permission revoked, or capture no longer
 * allowed — rather than missing: not about the device, so it ends the source
 * like any other such failure (spec 2026-10-04 §2) instead of marking the
 * device and waiting. With the permission gone the listing loses its labels,
 * so a wait would never end and say nothing.
 */
function refused(error: unknown): boolean {
  if (!(error instanceof MicrophoneCaptureError)) return false;
  const name = (error.cause as { name?: unknown } | null | undefined)?.name;
  // PermissionDeniedError: older Chromium's name for NotAllowedError (as in describeMicrophoneFailure).
  return name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError';
}

export type NoiseSuppression = 'off' | 'standard' | 'enhanced';

/** The settings a microphone follows, read live. */
export interface MicSettings {
  /** The selected device; undefined while none is, and the source waits for one. */
  deviceId(): string | undefined;
  /** The selected device's name, for the notices. */
  deviceLabel(): string | undefined;
  /** Whether the OS still lists the device. */
  isListed(deviceId: string): boolean;
  /** Whether the store has already marked the device unusable (it still selects it until its next sync). */
  isUnusable(deviceId: string): boolean;
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
  /** The open that `trackEnded` last reopened, and when it came up: its track ending again soon means the device keeps dropping. */
  let reopened: { generation: number; at: number } | null = null;
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

  /** Opens `deviceId`; `name` is its label, read by the caller while it was the selection — after the await the store may select another. */
  const begin = async (name: string) => {
    if (!(await recorder.begin(deviceId))) throw new Error('The microphone could not be opened. Reload the page and try again.');
    open = true;
    label = name;
    const mine = ++generation;
    unwatch = core.watch(recorder.getStream(), () => queue(() => trackEnded(mine)));
    await recorder.record((data) => core.deliver(data.mono));
  };

  // A device switch is a passing event: the surfaces hide its notice after a
  // while, the conversation and its export keep it (jiangzhuo, 2026-10-05).
  const notice = (code: string, message: string, params: Record<string, string>, severity: 'warning' | 'info' = 'warning') =>
    core.degrade({ code, message, params, severity, lifetime: 'transient' });

  /** Opens `next` (or waits, for none) and says where the microphone went, when it went there because of a loss. */
  const switchTo = async (next: string | undefined) => {
    // Read now, while the selection is `next`: by the time it has opened, the store may have moved on.
    const name = settings.deviceLabel() ?? next ?? '';
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
      await begin(name);
    } catch (error) {
      if (core.stopped) return;
      // Refused, not missing: rethrown, so `queue` ends the source with it.
      if (refused(error)) throw error;
      // This device will not open: the store leaves it out and selects the
      // next one, which `follow` then opens. The failed one is reported as the
      // device that went away, unless one already did.
      lost ??= name;
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
    // The failed device is marked but the store has not moved off it yet: wait for it.
    if (!open && next !== undefined && next === deviceId && settings.isUnusable(next)) return;
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
    // The reopen of this very open ended within the hold — a track already
    // ended when watched lands here too, at once: the device keeps dropping.
    // Reopening again would loop (getUserMedia, a new graph, the OS indicator
    // flickering), so it counts as a device that will not open.
    const dropping = reopened !== null && reopened.generation === which && Date.now() - reopened.at < REOPEN_HOLD_MS;
    await close();
    if (core.stopped) return;
    if (dropping) {
      // `lost` stays: the store's next choice, or waiting, gets the notice.
      settings.markUnusable(gone);
      return;
    }
    try {
      // The same device: it keeps the name it opened with.
      await begin(label);
      reopened = { generation, at: Date.now() };
      // A blip: the same device opened again, nothing to tell.
      lost = null;
    } catch (error) {
      if (core.stopped) return;
      if (refused(error)) throw error;
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
    await begin(label);
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
