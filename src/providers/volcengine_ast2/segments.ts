/**
 * Doubao's subtitles as segments (survey §2.10): each side's
 * `*SubtitleStart` / `Response` / `End` becomes one segment, opened when it
 * first has text, its text a snapshot, closed at `End`. No origin and no
 * timing (choice 3): L2 pairs the two sides by proximity (F16). Pure: the
 * adapter hands it each subtitle and forwards what it emits.
 */
import type { AdapterEvents, Ref, Side } from '../../lib/contract/adapter';

export type SubtitlePhase = 'start' | 'response' | 'end';

export type SegmentSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed'>;

interface SideState {
  /** Allocated at `Start` (or the first text), released at `End`. */
  ref: Ref | null;
  opened: boolean;
  text: string;
}

const idle = (): SideState => ({ ref: null, opened: false, text: '' });

export class Ast2Segments {
  private next: Ref = 1;
  private readonly sides: Record<Side, SideState> = { source: idle(), translation: idle() };
  private lastTranslation: Ref | undefined;

  constructor(private readonly sink: SegmentSink) {}

  /**
   * One subtitle message; answers the side's ref after it — null when it
   * has none — for the adapter's frame.
   * - `start`: the previous segment of the side closes as it stands (its
   *   `End` never came) or, never shown, is dropped; a ref is allocated,
   *   and nothing is emitted until text arrives.
   * - `response`: the whole text so far. A `Response` with no `Start`
   *   allocates once, not once per frame (survey §1.18.3); an empty one
   *   shows nothing.
   * - `end`: the final text, then the close. An empty `End` of a segment
   *   never shown is the server VAD's false start: nothing; of one shown, it
   *   closes with the text it had (survey §1.18.4).
   */
  subtitle(side: Side, phase: SubtitlePhase, text: string): Ref | null {
    const state = this.sides[side];
    if (phase === 'start') {
      this.finish(side);
      state.ref = this.next++;
      return state.ref;
    }
    if (text) this.show(side, text);
    const ref = state.ref;
    if (phase === 'end') this.finish(side);
    return ref;
  }

  /**
   * The translation a spoken sentence belongs to (ruling 10): the one
   * started now — shown or not, as the old client locked it to the item it
   * minted at `Start` (`VolcengineAST2Client.ts:646-652, 810-812`) — else the
   * last one shown; none before any. A ref not yet opened is fine: L1 holds
   * its audio until the segment opens (`Conversation.ts`, `pending`).
   */
  speechRef(): Ref | undefined {
    return this.sides.translation.ref ?? this.lastTranslation;
  }

  private show(side: Side, text: string): void {
    const state = this.sides[side];
    if (state.ref === null) state.ref = this.next++;
    if (!state.opened) {
      this.sink.segmentOpened({ ref: state.ref, side });
      state.opened = true;
      if (side === 'translation') this.lastTranslation = state.ref;
    }
    if (text !== state.text) {
      this.sink.segmentText({ ref: state.ref, text });
      state.text = text;
    }
  }

  private finish(side: Side): void {
    const state = this.sides[side];
    if (state.ref !== null && state.opened) this.sink.segmentClosed({ ref: state.ref });
    // In place: `subtitle` still holds this state object.
    Object.assign(state, idle());
  }
}
