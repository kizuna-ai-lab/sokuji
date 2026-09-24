/**
 * The echo monitor on the new capture (spec: "The echo monitor keeps its
 * three probes"): today's `EchoMonitor`, unchanged, fed from the sources'
 * pcm and the playback's tts tap instead of the recorder callbacks and the
 * player's ring. It runs while any source is attached; starting, it drains
 * the tap, so speech played while nothing listened is never correlated. It is
 * the tap's only reader.
 */
import type { LegName } from '../../conversation/types';
import { EchoMonitor, type EchoMonitorHooks, type EchoNoticeState } from '../../modern-audio/EchoMonitor';
import type { Source } from '../../session/source';
import type { PcmTap } from '../pcmTap';

/** The part of `EchoMonitor` the watch drives. */
export interface EchoMonitorLike {
  pushMic(pcm: Int16Array): void;
  pushParticipant(pcm: Int16Array): void;
  start(): void;
  stop(): void;
  readonly running: boolean;
}

export interface EchoWatch {
  /** Feeds a leg's capture to its probe while attached; returns the detach. */
  attach(leg: LegName, source: Source): () => void;
  /** One listener, the latest (`useEchoNotice`'s contract); null removes it. */
  onNotice(listener: ((state: EchoNoticeState | null) => void) | null): void;
  setDiagnostics(enabled: boolean): void;
}

export function createEchoWatch(
  ttsTap: PcmTap,
  createMonitor: (hooks: EchoMonitorHooks) => EchoMonitorLike = (hooks) => new EchoMonitor(hooks),
): EchoWatch {
  let listener: ((state: EchoNoticeState | null) => void) | null = null;
  let diagnostics = false;
  let attached = 0;
  const monitor = createMonitor({
    readPlayedTts: () => ttsTap.read(),
    onChange: (state) => listener?.(state),
    // Opt-in (the `sokuji.echoDiagnostics` flag), once a second: information, not a failure.
    onDiagnostic: (line) => {
      if (diagnostics) console.info(`[Sokuji] [EchoMonitor] ${line}`);
    },
  });

  return {
    attach(leg, source) {
      const off = source.onPcm(leg === 'speaker' ? (pcm) => monitor.pushMic(pcm) : (pcm) => monitor.pushParticipant(pcm));
      attached += 1;
      if (!monitor.running) {
        ttsTap.read();
        monitor.start();
      }
      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        off();
        attached -= 1;
        if (attached === 0) monitor.stop();
      };
    },
    onNotice(next) {
      listener = next;
    },
    setDiagnostics(enabled) {
      diagnostics = enabled;
    },
  };
}
