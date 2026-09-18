/**
 * What a client sees of the segmentation stage.
 *
 * Deliberately one method and one flag. Clients never construct a runtime,
 * never import a store, and never learn which model ran: a client that
 * receives null, or a disabled runtime, behaves exactly as it does today.
 */

export type PunctuationModelId = 'fireredpunc' | 'edge-punct-en' | 'sat-3l-sm';

export interface PunctuationResult {
  /** The input's characters with marks inserted. SaT emits no marks, so its
   *  adapter writes one terminal at each predicted boundary. */
  text: string;
  /** Offsets into `text`, just past each sentence end, per the model's own
   *  counting rule (Edge-Punct: its periods; SaT: its boundaries;
   *  FireRedPunc: 。！？ plus a `.` that periodIsNotSentenceEnd rejects). */
  sentenceEnds: number[];
  /** Sentence ends plus commas. */
  breakpoints: number[];
  model: PunctuationModelId;
}

export interface SegmentationRuntime {
  /** False when the user switched the feature off. A disabled runtime never
   *  seals and never downloads. */
  readonly enabled: boolean;
  /**
   * Punctuate one tail. Resolves to null — never rejects — whenever the stage
   * cannot help: model not downloaded, still loading, disabled for the
   * session after repeated failures, timed out, or the device is too small.
   * The caller then behaves as if there were no model at all.
   */
  punctuate(
    lang: string,
    text: string,
    opts?: { signal?: AbortSignal },
  ): Promise<PunctuationResult | null>;
}
