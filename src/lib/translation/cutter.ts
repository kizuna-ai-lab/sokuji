// src/lib/translation/cutter.ts
//
// The shared cutter: which stretches of one source segment a translator that
// asks and is answered is sent, and when. Fed the successive snapshots of one
// origin, it yields the sentences of the text that will not change any more
// while the source is open, and the rest when the source closes. Pure state
// per origin; no model, no timer.
//
// It stands beside local inference's `SentenceCut`, and shares the sentence
// rule with it (`sentenceEnds`). `SentenceCut` cuts a recognizer's own
// hypotheses, which are rewritten as they grow, with a punctuation model and
// a cursor counted in letters; and its cuts are the source rows. This cutter
// reads text another unit already owns: it cuts only inside what that unit
// said is stable, so an offset is cursor enough, and it never touches a row.
import type { TextRange } from '../contract/adapter';
import { hasSpeech, type SourceSnapshot } from '../contract/translation';
import { sentenceEnds } from '../segmentation/sentenceEnd';

/** A stretch of a source to translate. `span`: where `text` sits in the source's whole text. */
export interface Stretch { text: string; span: TextRange }

export interface SourceCutter {
  /**
   * The next snapshot of the origin. Yields what is ready to be translated and was not yielded before: at most
   * one stretch, never blank, without the spaces around it.
   */
  feed(snapshot: Pick<SourceSnapshot, 'text' | 'stableLen' | 'closed'>): Stretch[];
}

/**
 * `text[from, to)` without the spaces around it, or nothing when it holds no letter or digit (`hasSpeech`): that is
 * what makes a stretch worth a job, and what confirms that a sentence before it has ended.
 */
function stretchOf(text: string, from: number, to: number): Stretch[] {
  const piece = text.slice(from, to);
  if (!hasSpeech(piece)) return [];
  const start = from + (piece.length - piece.trimStart().length);
  const end = from + piece.trimEnd().length;
  return [{ text: text.slice(start, end), span: [start, end] }];
}

/**
 * A cutter for one origin.
 *
 * While the source is open, only its stable start is read; what lies past it is as good as not there. A sentence
 * of the stable start is yielded once a stable letter or digit follows its end: the last mark of a growing text
 * is not known to end a sentence (a decimal, an abbreviation and a pause all look like one until the next word
 * comes). Sentences that became ready together are one stretch. When the source closes, the rest is one stretch.
 *
 * A stable length is held to the text it came with, and never goes back below what was yielded. A caller that
 * rewrites text it said was stable gets no second translation of it.
 */
export function createSourceCutter(): SourceCutter {
  /** How much of the source has been yielded, or passed over as blank. */
  let cut = 0;
  let done = false;
  return {
    feed({ text, stableLen, closed }) {
      if (done) return [];
      if (closed) {
        done = true;
        return stretchOf(text, cut, text.length);
      }
      const stable = text.slice(0, Math.min(Math.max(stableLen, 0), text.length));
      let ready = cut;
      for (const end of sentenceEnds(stable)) {
        if (end > ready && hasSpeech(stable.slice(end))) ready = end;
      }
      if (ready === cut) return [];
      const from = cut;
      cut = ready;
      return stretchOf(text, from, ready);
    },
  };
}
