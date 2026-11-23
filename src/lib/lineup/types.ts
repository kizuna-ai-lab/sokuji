// src/lib/lineup/types.ts
//
// The line-up: which provider serves each stage of a session. One provider id
// per stage, using the ids the app already stores (owner, 2026-11-15).

export type StageName = 'transcription' | 'translation' | 'speech' | 'summarisation';
/** The stages a session runs; summarisation comes with the notes. */
export type RunStage = Exclude<StageName, 'summarisation'>;
export const RUN_STAGES: readonly RunStage[] = ['transcription', 'translation', 'speech'];

/** The line-up id that served each run stage, e.g. { transcription: 'local_inference', translation: 'bing', speech: 'edge' }. */
export type StageIds = Readonly<Record<RunStage, string>>;

/**
 * The stage sets a provider's options act on (mock v19): each `StagePart` in its `Settings` names one of these, and
 * the provider's `settingsStages` lists the ones it uses, so the line-up page knows which cards have options without
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

/**
 * What one option can serve, who runs it, which of those stages go together, and who it bills through. Derived, never
 * declared: `capsOf` (`src/lib/plan/capsOf.ts`) reads it off the provider's units under its default settings, and the registry
 * registers the result as the catalog. Each field names its rule.
 */
export interface ProviderCaps {
  /** The provider's id. */
  id: string;
  /** Every stage some unit of the provider occupies, in `RUN_STAGES` order. */
  stages: readonly RunStage[];
  /** The provider definition that runs this option. Every option is a host of its own, so this is its own id. */
  host: string;
  /**
   * The stages one connection of it carries together and never apart; choosing it for one of them chooses it for
   * all (the vendor's interface). Rule: every run stage for an end-to-end provider (`Provider.endToEnd`); otherwise
   * the stages it serves that go in pairs, two stages being a pair when no unit occupies one of them without the
   * other. Absent: each stage alone, but for `translatesOwn`.
   */
  joint?: readonly RunStage[];
  /**
   * True: it translates only what it transcribes itself, on the one connection that does both. Choosing it for
   * translation chooses it for transcription; its transcription may stand alone, translated by another option. Rule:
   * some occupation (the stages a unit occupies when asked for exactly those) has transcription without translation, some has translation, and every one with translation has transcription.
   * Absent otherwise.
   */
  translatesOwn?: boolean;
  /** Who it bills through, from the provider's kind: `managed` is Kizuna AI's, `own-key` a key, `local` and `online` none. */
  account: 'kizuna' | 'key' | 'none';
  /** True: this option may serve `speech` while another host transcribes and translates. Rule: some unit occupies speech alone. */
  voiceAlone: boolean;
  /**
   * True: this host's transcription and translation may be read aloud by another host's voice. Rule: some unit
   * occupies stages without speech; never for an end-to-end provider.
   */
  takesVoice: boolean;
}
