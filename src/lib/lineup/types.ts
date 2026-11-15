// src/lib/lineup/types.ts
//
// The line-up: which provider serves each stage of a session. One provider id
// per stage, using the ids the app already stores (owner, 2026-11-15).

export type StageName = 'transcription' | 'translation' | 'speech' | 'summarisation';
/** The stages a session runs; summarisation comes with the notes. */
export type RunStage = Exclude<StageName, 'summarisation'>;
export const RUN_STAGES: readonly RunStage[] = ['transcription', 'translation', 'speech'];

/**
 * The stage sets a provider's options act on (mock v19): each `StagePart` in its `Settings` names one of these, and
 * the provider's `optionStages` lists the ones it uses, so the line-up page knows which cards have options without
 * drawing them.
 */
export const TR: readonly RunStage[] = ['transcription'];
export const TL: readonly RunStage[] = ['translation'];
export const SP: readonly RunStage[] = ['speech'];
export const TR_TL: readonly RunStage[] = ['transcription', 'translation'];
export const ALL_STAGES: readonly RunStage[] = RUN_STAGES;

export interface LineUp {
  transcription: string | null;
  translation: string | null;
  speech: string | null;
  summarisation: string | null;
}

/** What one provider can serve, which of those stages it binds into one connection, and who it bills through. */
export interface ProviderCaps {
  id: string;
  stages: readonly RunStage[];
  binds: readonly (readonly RunStage[])[];
  /** Providers of one family can be combined in one session today; across families, not yet. */
  family: string;
  account: 'kizuna' | 'key' | 'none';
}

export type RunTarget = { ok: true; provider: string } | { ok: false; reason: 'incomplete' | 'mixed' | 'unbound' };
