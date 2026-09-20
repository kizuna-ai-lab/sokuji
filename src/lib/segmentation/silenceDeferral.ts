/**
 * The rule that stops a silence timer cutting a sentence in half.
 *
 * Every continuous client segments on an idle timer: so long since the last
 * delta, close the bubble. That timer measures wall-clock silence, and a
 * speaker who pauses at a comma for longer than the setting gets a bubble cut
 * where no sentence ended. A live Gemini session at N = 3 ended one source
 * bubble on "…成为商人或者是商队的向导，" and opened the next, ten seconds
 * later, with "以及保镖。" — one sentence in two bubbles, in the mode whose
 * whole promise is bubbles cut at sentences.
 *
 * So while the segmentation stage is running, the timer defers on a
 * mid-sentence tail instead of closing — but only while the speaker is still
 * producing text. At each expiry:
 *
 *   - tail empty, or ending at a sentence terminal → close, as always;
 *   - mid-sentence and the tail has grown since the previous expiry → re-arm;
 *   - mid-sentence and the tail is unchanged → the speaker has stopped, close.
 *
 * The last clause is what keeps an abandoned sentence from hanging for ever:
 * the wait is one extra window past the last word, and it is bounded by text
 * rather than by another timeout. With no stream — the stage off, or By pause
 * — no client consults this at all and every timer behaves as it did before.
 */
import { lastSentenceEnd } from './sentenceEnd';

/**
 * The unsealed tail is a place a bubble may end: nothing left to seal, or a
 * sentence that finished. Trailing whitespace belongs to neither.
 */
export function tailIsClean(tail: string): boolean {
  const trimmed = tail.trimEnd();
  return trimmed.length === 0 || lastSentenceEnd(trimmed) === trimmed.length;
}

/**
 * One timer's memory of the tail it saw at its previous expiry.
 *
 * One instance per silence timer, because "has the tail grown" is a question
 * about that timer's own side. Trailing whitespace is not growth.
 */
export class SilenceDeferral {
  private tailAtLastExpiry: string | null = null;

  /**
   * Call once per expiry, with the stream's pending tail. True means re-arm
   * and leave the item open; false means close it exactly as before.
   */
  deferAtExpiry(tail: string): boolean {
    const trimmed = tail.trimEnd();
    const previous = this.tailAtLastExpiry;
    this.tailAtLastExpiry = trimmed;
    if (tailIsClean(trimmed)) return false;
    return trimmed !== previous;
  }

  /** Forget the previous expiry, so the next item starts with its own window. */
  reset(): void {
    this.tailAtLastExpiry = null;
  }
}
