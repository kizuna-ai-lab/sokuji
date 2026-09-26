import type { Side } from '../contract/adapter';
import type { Languages, LegName, SegmentId } from '../conversation/types';

/** A drawn line: a stretch of one segment's text, carrying what a surface draws. */
export interface Row {
  /** `${segmentId}:${k}` — stable while the cut does not change. */
  key: string;
  segmentId: SegmentId;
  side: Side;
  start: number;
  end: number;
  /**
   * The segment's text over [start, end), untrimmed: adjacent rows of one
   * segment concatenated reproduce its text. A bubble trims it for display;
   * a band joins rows as they are.
   */
  text: string;
  /** The segment is final. */
  final: boolean;
  /** The segment's detected language, when the provider reported one. */
  language?: string;
}

export type Pairing = 'stated' | 'inferred' | 'none';

export type Entry =
  | {
      kind: 'exchange';
      id: string;
      leg: LegName;
      languages: Languages;
      pairing: Pairing;
      source: Row[];
      translation: Row[];
      /** Earliest `openedAt` in the group. */
      t: number;
    }
  | {
      kind: 'notice';
      id: string;
      leg: LegName;
      severity: 'error' | 'warning';
      message: string;
      code?: string;
      params?: Record<string, string | number>;
      at: number;
    };

export interface CutSettings {
  mode: 'off' | 'pause' | 'sentences';
  /** 0 = whole segment. */
  sentencesPerRow: number;
  /** The pause that cuts a source segment's rows under the pause mode; 0 = none. */
  sourcePauseMs: number;
  /** The same for a translation segment. */
  translationPauseMs: number;
}

export interface PairingThresholds {
  /** Fraction of the translation's media span that must overlap the source's. */
  minOverlap: number;
  /** How long after a source opens a translation may open and still be its pair. */
  proximityMs: number;
}

export interface ProjectionSettings extends CutSettings {
  pairing: PairingThresholds;
}
