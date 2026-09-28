/**
 * OpenAI Translate's deltas → segments (survey §2.9): the old client's two
 * independent sides (`OpenAITranslateGAClient.ts:95-99, 265-289`) without
 * its items — a pure machine on the request's clock. Each side is its own
 * segment, closed by its own silence timer; the translation's timer is held
 * by its content audio too, which opens a translation segment when none is
 * open (`:558-627`). Neither side states an origin: L2 infers the pair
 * (F16).
 *
 * Copied from Gemini's Live Translate half (choice 4): the per-side
 * `ensure` / `close` / `arm` / `cancel` and the mid-sentence deferral of
 * `GeminiTurns` (`src/providers/gemini/turns.ts`). Not shared, because
 * three rules differ: here content audio opens and re-arms the translation,
 * where Gemini's never re-arms and plays ref-less outside an open one
 * (Gemini choice 8); here each audio frame carries a range (ruling 6); and
 * `GeminiTurns` is one class whose Live Translate half shares its fields
 * with the dialogue models' turns, cancels and suppressions. Importing it
 * would put another provider's session module on this one's session side.
 */
import type { AdapterEvents, Ref } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import { SilenceDeferral } from '../../lib/segmentation/silenceDeferral';
import type { TranslateConfig } from './config';

export type SegmentSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'audio'>;

export interface TranslateSegmentsOptions {
  clock: Pick<Clock, 'setTimeout'>;
  silence: TranslateConfig['silence'];
  sink: SegmentSink;
}

type SideName = 'source' | 'translation';

interface OpenSide {
  ref: Ref;
  /** Every delta so far, joined as it came: the deltas are append-only, and nothing goes between them (the SDK). */
  text: string;
  /** Translation only: where the last played frame's range ended (ruling 6). */
  spoken: number;
}

export class TranslateSegments {
  private refs = 0;
  private readonly sides: Record<SideName, OpenSide | null> = { source: null, translation: null };
  private readonly timers: Record<SideName, (() => void) | null> = { source: null, translation: null };
  private readonly deferral: Record<SideName, SilenceDeferral> = { source: new SilenceDeferral(), translation: new SilenceDeferral() };
  private stopped = false;

  constructor(private readonly o: TranslateSegmentsOptions) {}

  /** A source transcript delta. */
  input(delta: string): void {
    this.text('source', delta);
  }

  /** A translation transcript delta. */
  output(delta: string): void {
    this.text('translation', delta);
  }

  /**
   * Content audio (the adapter drops heartbeats before this): it opens the
   * translation segment when none is open and re-arms its timer whether it
   * plays or not, so Text only changes playback and nothing else (choice 5).
   * Played, it carries the translation's text as it stands at the frame's
   * arrival — `[the previous played frame's end, the text's length]` — an
   * alignment by arrival, not a known correspondence (ruling 6; choice 6).
   */
  audio(pcm: Int16Array, play: boolean): void {
    if (this.stopped || pcm.length === 0) return;
    const side = this.ensure('translation');
    this.arm('translation');
    if (!play) return;
    const end = side.text.length;
    this.o.sink.audio({ pcm, ref: side.ref, range: [side.spoken, end] });
    side.spoken = end;
  }

  /** A `.done` event, should the endpoint send one (choice 18): that side closes now, as the old client closed its item. */
  done(side: SideName): void {
    if (this.stopped) return;
    this.close(side);
  }

  stop(): void {
    this.stopped = true;
    this.cancel('source');
    this.cancel('translation');
  }

  private text(name: SideName, delta: string): void {
    if (this.stopped || !delta) return;
    const side = this.ensure(name);
    side.text += delta;
    this.o.sink.segmentText({ ref: side.ref, text: side.text });
    this.arm(name);
  }

  private ensure(name: SideName): OpenSide {
    const open = this.sides[name];
    if (open) return open;
    const ref = ++this.refs;
    this.o.sink.segmentOpened({ ref, side: name });
    const fresh: OpenSide = { ref, text: '', spoken: 0 };
    this.sides[name] = fresh;
    return fresh;
  }

  private close(name: SideName): void {
    this.cancel(name);
    this.deferral[name].reset();
    const open = this.sides[name];
    if (!open) return;
    this.sides[name] = null;
    this.o.sink.segmentClosed({ ref: open.ref });
  }

  /** (Re)starts a side's silence countdown (`OpenAITranslateGAClient.ts:265-289`). */
  private arm(name: SideName): void {
    const { silence } = this.o;
    this.cancel(name);
    this.timers[name] = this.o.clock.setTimeout(() => {
      this.timers[name] = null;
      const open = this.sides[name];
      if (this.stopped || !open) return;
      // While the display cuts by sentences, a pause mid-sentence is the speaker resting: one more window, while the text still grows (Gemini choice 7).
      if (silence.deferMidSentence && this.deferral[name].deferAtExpiry(open.text)) {
        this.arm(name);
        return;
      }
      this.close(name);
    }, name === 'source' ? silence.sourceMs : silence.translationMs);
  }

  private cancel(name: SideName): void {
    this.timers[name]?.();
    this.timers[name] = null;
  }
}
