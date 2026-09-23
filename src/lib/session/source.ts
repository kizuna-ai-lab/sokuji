import type { LegName } from '../conversation/types';

/** One leg's capture (spec: "Sources, in full"): 24 kHz mono pcm, an end, and a degradation. */
export interface Source {
  onPcm(listener: (pcm: Int16Array) => void): () => void;
  /** Fires at most once, when the capture can no longer deliver: a device unplugged, a tab closed, the app-capture helper gone. */
  onEnded(listener: (reason: string) => void): () => void;
  /** Still delivering, but worse: app capture fell back to whole-system capture. */
  onDegraded(listener: (message: string) => void): () => void;
  stop(): Promise<void>;
}

/** Opens one leg's capture; rejects when it cannot open, and honours `signal`. */
export type OpenSource = (leg: LegName, signal: AbortSignal) => Promise<Source>;
