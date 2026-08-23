/** The three pipeline stages a direction needs filled. */
export type Stage = 'asr' | 'translation' | 'tts';

/** One stage's stored choice. `modelId: ''` means auto — resolve it every time. */
export interface StageSelection {
  modelId: string;
  /** Quantization pin, scoped to this slot. Absent under auto. */
  variant?: string;
  /** Reserved for per-stage cloud providers. Unset today = local. */
  source?: string;
}

export interface DirectionSelection {
  asr: StageSelection;
  translation: StageSelection;
  tts: StageSelection;
}

/**
 * Keyed `${src}→${tgt}`. Only directions the user has explicitly touched appear;
 * an absent direction is entirely auto, which is why no LRU cap is needed.
 */
export type Selections = Record<string, DirectionSelection>;

export const EMPTY_STAGE: StageSelection = Object.freeze({ modelId: '' });

/** A fresh all-auto direction on every call — a factory, not a constant, so a
 *  caller that spreads and mutates cannot poison a shared object. */
export const emptyDirection = (): DirectionSelection => ({
  asr: { modelId: '' },
  translation: { modelId: '' },
  tts: { modelId: '' },
});

export const directionKey = (src: string, tgt: string): string => `${src}→${tgt}`;

/** Splits on the first arrow only; language tags never contain one, but a
 *  malformed key must not silently produce a three-part direction. */
export const splitDirection = (dir: string): [string, string] => {
  const i = dir.indexOf('→');
  return i < 0 ? [dir, ''] : [dir.slice(0, i), dir.slice(i + 1)];
};

/** A normalised candidate. Both providers project their catalog onto this so the
 *  resolver stays free of provider knowledge. */
export interface Candidate {
  id: string;
  recommended: boolean;
  sortOrder: number;
  /** 0 = unknown; sorts last among ties. */
  sizeBytes: number;
  /** Downloaded, or cloud with a valid key. */
  ready: boolean;
  /** WASM `deviceReady()`; native `!hardwareGated()`. */
  hardwareOk: boolean;
  /** Reserved: false for every local implementation today. */
  needsKey: boolean;
  /** May auto pick this? False for candidates selectable only on purpose —
   *  today, the AST-capable ASR entries that appear in the translation pool. */
  autoEligible: boolean;
  /** Is this pinned quantization still offered and runnable here?
   *  `undefined` (no pin) is always supported. */
  supportsVariant: (variant: string | undefined) => boolean;
}

export interface CandidateSource {
  /** Candidates for this stage and direction. Already language-filtered. */
  pool: (stage: Stage, src: string, tgt: string) => Candidate[];
  /** Catalog membership, language-agnostic. Separates "wrong direction"
   *  (revivable) from "no longer exists" (never revivable). */
  has: (stage: Stage, id: string) => boolean;
}

export type ResolutionReason =
  | 'not-in-catalog'
  | 'lang-incompatible'
  | 'not-downloaded'
  | 'hardware-gated'
  | 'needs-key'
  | 'no-candidate';

export interface ResolutionNote {
  direction: string;
  stage: Stage;
  from: string | null;
  to: string | null;
  reason: ResolutionReason;
}

export interface Resolved {
  modelId: string;
  variant?: string;
  source: 'explicit' | 'auto';
}

export interface StageResult {
  resolved: Resolved | null;
  note?: ResolutionNote;
  /** The stored selection can never become valid — the store should drop it. */
  prune?: true;
}

export interface DirectionResult {
  asr: Resolved | null;
  translation: Resolved | null;
  tts: Resolved | null;
  notes: ResolutionNote[];
  prunes: Array<{ direction: string; stage: Stage }>;
}
