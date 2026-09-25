import { AdapterStartError } from '../contract/adapter';
import type { LegName } from '../conversation/types';

/** A degradation a source reports: still delivering, but worse. The code lets a surface localize it. */
export interface SourceNotice {
  code: string;
  message: string;
}

/** One leg's capture (spec: "Sources, in full"): 24 kHz mono pcm, an end, and a degradation. */
export interface Source {
  onPcm(listener: (pcm: Int16Array) => void): () => void;
  /** Fires at most once, when the capture can no longer deliver: a device unplugged, a tab closed, the app-capture helper gone. */
  onEnded(listener: (reason: string) => void): () => void;
  /** Still delivering, but worse: app capture fell back to whole-system capture. */
  onDegraded(listener: (notice: SourceNotice) => void): () => void;
  /** The capture's own track, for an adapter that sends a native track (WebRTC); absent where there is none. */
  readonly track?: MediaStreamTrack;
  /** Stops capturing before its first `await`: on `pagehide` it is called and not awaited. */
  stop(): Promise<void>;
}

/** Opens one leg's capture; rejects when it cannot open, and honours `signal`. */
export type OpenSource = (leg: LegName, signal: AbortSignal) => Promise<Source>;

/**
 * A source that could not open, for a reason the user can be told in words:
 * `code` is a notice code (`notices.<code>`). An `AdapterStartError`, so a
 * failed start carries its code exactly as it carries an adapter's.
 */
export class SourceOpenError extends AdapterStartError {}
