// src/lib/plan/speechFeed.ts
//
// From a text unit's translation segments to what a voice is asked to read:
// each stretch of a translation once it is stable, then the end of the
// utterance when the segment closes. A segment that never says how much of it
// is stable is read whole at its close. Pure state per leg.
import type { AdapterEvents, Ref, TextRange } from '../contract/adapter';

type Opened = Parameters<AdapterEvents['segmentOpened']>[0];
type Text = Parameters<AdapterEvents['segmentText']>[0];
type Closed = Parameters<AdapterEvents['segmentClosed']>[0];

export interface SpeechFeedSink {
  /** `span`: where `text` sits in the segment's whole translation. */
  speak(ref: Ref, text: string, span: TextRange, language: string): void;
  end(ref: Ref): void;
}

export interface SpeechFeed {
  opened(e: Opened): void;
  text(e: Text): void;
  closed(e: Closed): void;
  /** Forgets every open segment: nothing more is spoken or ended for them. */
  reset(): void;
}

/**
 * One open translation segment: how far it has been spoken, its last text, the language it last stated, and the
 * last stable length it stated, if it ever stated one.
 */
interface Open { spoken: number; text: string; language?: string; stable?: number }

/**
 * A feed for one leg, handed the text unit's segment events as they come. Only a segment opened as a translation
 * is read. `target`: the leg's target language, asked each time a text that states no language is spoken.
 */
export function createSpeechFeed(sink: SpeechFeedSink, target: () => string): SpeechFeed {
  const open = new Map<Ref, Open>();

  /** Speaks `text[spoken, upTo)`, if there is any. A text shorter than what was spoken (a revised row) leaves `spoken` where it is. */
  const speakTo = (ref: Ref, segment: Open, upTo: number) => {
    const end = Math.min(upTo, segment.text.length);
    if (end <= segment.spoken) return;
    const span: TextRange = [segment.spoken, end];
    segment.spoken = end;
    sink.speak(ref, segment.text.slice(span[0], span[1]), span, segment.language ?? target());
  };

  return {
    opened(e) {
      if (e.side === 'translation') open.set(e.ref, { spoken: 0, text: '' });
    },
    text(e) {
      const segment = open.get(e.ref);
      if (!segment) return;
      segment.text = e.text;
      if (e.language !== undefined) segment.language = e.language;
      // No stable length: nothing is known to stay until the segment closes.
      if (e.stableLen === undefined) return;
      segment.stable = e.stableLen;
      speakTo(e.ref, segment, e.stableLen);
    },
    closed(e) {
      const segment = open.get(e.ref);
      if (!segment) return;
      open.delete(e.ref);
      // A segment that stated a stable length is read up to the last one it stated: what lies past it was never
      // said to stay (a partial showing when the segment was cut short). One that stated none is read whole.
      speakTo(e.ref, segment, segment.stable ?? segment.text.length);
      sink.end(e.ref);
    },
    reset() {
      open.clear();
    },
  };
}
