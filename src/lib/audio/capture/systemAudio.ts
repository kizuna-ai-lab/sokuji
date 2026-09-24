/**
 * Electron's system audio as the participant source (spec: "Sources, in
 * full"), replacing `ModernBrowserAudioService`'s sequence step by step:
 * connect the chosen source over IPC, then record it with the recorder the
 * main process asks for — the per-application helper (Windows, and all of
 * macOS), a PipeWire tap's monitor device (Linux per-application), or
 * getDisplayMedia loopback (whole-system on Windows and Linux).
 */
import { SAMPLE_RATE } from '../../contract/adapter';
import { describeCause, reportWarning } from '../../diagnostics/report';
import { AppAudioRecorder } from '../../modern-audio/AppAudioRecorder';
import { DeviceCaptureRecorder } from '../../modern-audio/DeviceCaptureRecorder';
import { LoopbackRecorder } from '../../modern-audio/LoopbackRecorder';
import type { Source } from '../../session/source';
import { createSourceCore } from './core';

export const APP_CAPTURE_LOST = 'app_capture_lost_using_system_audio';
export const APP_MONITOR_MISSING = 'app_capture_monitor_missing';
export const SILENT_NO_PERMISSION = 'silent_no_permission';

/** The settings a system-audio source follows, read live. */
export interface SystemAudioSettings {
  /** The chosen participant source: 'desktop-audio-loopback' (the whole system) or an 'app:…' id. */
  sourceId(): string;
  muted(): boolean;
  subscribe(listener: () => void): () => void;
  /** The helper heard audible audio: remembered, so a later silence reads as a permission problem (#492). */
  audioSeen(): void;
}

/** The part of a participant recorder this source drives. */
export interface ParticipantCapture {
  /** False when it cannot capture (it logs why and cleans up after itself). */
  begin(options?: { deviceId?: string }): Promise<boolean>;
  record(callback: (data: { mono: Int16Array }) => void): Promise<boolean>;
  end(): Promise<void>;
  getStream?(): MediaStream | null;
  onLost?: (() => void) | null;
  onWarning?: ((code: string) => void) | null;
  onAudioSeen?: (() => void) | null;
}

export interface SystemAudioDeps {
  invoke(channel: string, data?: unknown): Promise<unknown>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  wait(ms: number): Promise<void>;
  app(): ParticipantCapture;
  device(): ParticipantCapture;
  loopback(): ParticipantCapture;
}

export const electronSystemAudio = (): SystemAudioDeps => ({
  invoke: (channel, data) => window.electron.invoke(channel, data),
  enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  app: () => new AppAudioRecorder(SAMPLE_RATE),
  device: () => new DeviceCaptureRecorder(SAMPLE_RATE),
  loopback: () => new LoopbackRecorder(SAMPLE_RATE),
});

type Connection = { mode: 'app' } | { mode: 'device'; monitorId: string } | { mode: 'loopback' };

interface ConnectAnswer {
  success?: boolean;
  error?: string;
  capture?: string;
  monitorLabel?: string;
}

const SILENT_MESSAGE =
  'No audio has come through from the selected source yet: it may be silent, or Sokuji may lack permission to record it.';

export async function openSystemAudio(
  settings: SystemAudioSettings,
  signal: AbortSignal,
  deps: SystemAudioDeps = electronSystemAudio(),
): Promise<Source> {
  let sourceId = settings.sourceId();
  let recorder: ParticipantCapture | null = null;
  let connected = false;
  let unwatch = () => {};
  let unsubscribe = () => {};
  let chain: Promise<void> = Promise.resolve();

  /** Ends the recorder: its `onLost` detached first, since its own teardown kills the helper. */
  const stopRecorder = async () => {
    const current = recorder;
    recorder = null;
    unwatch();
    unwatch = () => {};
    if (!current) return;
    current.onLost = null;
    try {
      await current.end();
    } catch (error) {
      reportWarning('SystemAudio', `Stopping the system audio capture failed: ${describeCause(error)}`, { dedupeKey: 'system:end' });
    }
  };

  const close = async () => {
    await stopRecorder();
    if (!connected) return;
    connected = false;
    try {
      await deps.invoke('disconnect-system-audio-source');
    } catch (error) {
      reportWarning('SystemAudio', `Disconnecting the system audio source failed: ${describeCause(error)}`, { dedupeKey: 'system:disconnect' });
    }
  };

  const core = createSourceCore({
    muted: () => settings.muted(),
    track: () => recorder?.getStream?.()?.getAudioTracks()[0],
    release: async () => {
      unsubscribe();
      await chain;
      await close();
    },
  });

  /** A PipeWire tap's sink appears in the browser's device list a moment after it is created: retry briefly. */
  const findMonitor = async (label: string): Promise<string | undefined> => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const match = (await deps.enumerateDevices()).find((d) => d.kind === 'audioinput' && d.label.includes(label));
      if (match) return match.deviceId;
      await deps.wait(100);
    }
    return undefined;
  };

  const connect = async (id: string): Promise<Connection> => {
    const answer = (await deps.invoke('connect-system-audio-source', id)) as ConnectAnswer | undefined;
    if (answer?.success === false) throw new Error(answer.error || 'The system audio source did not connect.');
    connected = true;
    if (answer?.capture === 'app') return { mode: 'app' };
    if (answer?.monitorLabel) {
      const monitorId = await findMonitor(answer.monitorLabel);
      if (monitorId) return { mode: 'device', monitorId };
      // Widening from one application to the whole system must be visible.
      core.degrade({ code: APP_MONITOR_MISSING, message: 'The application capture did not appear, so all system audio is being translated instead.' });
    }
    return { mode: 'loopback' };
  };

  const record = async (connection: Connection) => {
    const next = connection.mode === 'app' ? deps.app() : connection.mode === 'device' ? deps.device() : deps.loopback();
    if (connection.mode === 'app') {
      next.onWarning = (code) => core.degrade({ code, message: code === SILENT_NO_PERMISSION ? SILENT_MESSAGE : `The application capture warned: ${code}` });
      next.onAudioSeen = () => settings.audioSeen();
      next.onLost = () => {
        // Captured now: by the time this runs, a queued switch may have already
        // made `recorder` point elsewhere, and this death is then stale (M1).
        const lost = next;
        chain = chain.then(() => fallBack(lost)).catch((error: unknown) => core.end(`System audio stopped: ${describeCause(error)}`));
      };
    }
    recorder = next;
    const options = connection.mode === 'app' ? { deviceId: sourceId } : connection.mode === 'device' ? { deviceId: connection.monitorId } : undefined;
    if (!(await next.begin(options))) {
      recorder = null;
      throw new Error('The system audio capture did not start.');
    }
    unwatch = core.watch(next.getStream?.() ?? null);
    await next.record((data) => core.deliver(data.mono));
  };

  /**
   * The helper died: widen to whole-system capture, visibly (ruling 5). Only
   * when the dead recorder is still the current one — a queued switch may
   * already have replaced it, in which case this death is stale (M1).
   */
  const fallBack = async (lost: ParticipantCapture) => {
    if (core.stopped || core.ended || recorder !== lost) return;
    core.degrade({ code: APP_CAPTURE_LOST, message: 'The application capture stopped, so all system audio is being translated instead.' });
    await stopRecorder();
    await record({ mode: 'loopback' });
  };

  try {
    await record(await connect(sourceId));
  } catch (error) {
    await close();
    throw error;
  }
  if (signal.aborted) {
    await core.stop();
    throw signal.reason ?? new Error('aborted');
  }

  unsubscribe = settings.subscribe(() => {
    const next = settings.sourceId();
    if (next === sourceId) return;
    sourceId = next;
    chain = chain
      .then(async () => {
        if (core.stopped || core.ended) return;
        await close();
        await record(await connect(sourceId));
      })
      .catch((error: unknown) => core.end(`The participant source could not switch: ${describeCause(error)}`));
  });
  return core;
}
