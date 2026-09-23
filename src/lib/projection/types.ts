import type { Side } from '../contract/adapter';
import type { Languages, LegName, SegmentId } from '../conversation/types';

/** A drawn line: a stretch of one segment's text. */
export interface Row {
  /** `${segmentId}:${k}` — stable while the cut does not change. */
  key: string;
  segmentId: SegmentId;
  side: Side;
  start: number;
  end: number;
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
  pauseMs: number;
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
