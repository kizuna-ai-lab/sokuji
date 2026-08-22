import type { ReactNode } from 'react';
import type { Stage, Resolved } from '../../../lib/local-inference/selection/types';
// (the two ReactNode-typed members below use this import)

export interface SlotCandidate {
  id: string;
  name: string;
  sizeLabel?: string;          // "234 MB" — provider formats it
}

export interface SlotId { dir: string; stage: Stage }   // dir = "ja→en"

export interface EngineAdapter {
  /** The two live directions, speaker first. */
  directions: Array<{ dir: string; src: string; tgt: string }>;
  /** Resolved view of one slot (null = nothing usable). */
  resolved(slot: SlotId): Resolved | null;
  /** Display name for a model id (chips/library share it). */
  displayName(id: string): string;
  /** READY implementations only — the short list an expanded slot shows. */
  readyCandidates(slot: SlotId): SlotCandidate[];
  /** Write an explicit pick ('' = back to auto). */
  select(slot: SlotId, modelId: string): void | Promise<void>;
  /** Per-stage extra controls row (native compute device); absent for WASM. */
  stageExtras?(slot: SlotId): ReactNode;
  /** Gate banner above the blocks (native engine bundle); absent for WASM. */
  gate?: ReactNode;
  /** Storage summary line for the storage row. */
  storageSummary: string;
  /** Which stages a direction renders (participant hides tts today). */
  stagesFor(dir: string, isSpeaker: boolean): Stage[];
  disabled: boolean;           // isSessionActive
}
