/**
 * Doubao's subtitles as segments (survey §2.10): each side's
 * `*SubtitleStart` / `Response` / `End` becomes one segment, opened when it
 * first has text, closed at `End`. A `Response` carries one piece of the
 * text and an `End` the whole of it (Gemini/AST2 follow-up, choice 1), so
 * the text shown is the pieces joined until the `End` replaces it. No
 * origin and no timing (choice 3): L2 pairs the two sides by proximity
 * (F16). Pure: the adapter hands it each subtitle and forwards what it
 * emits.
 */
import type { AdapterEvents, Ref, Side } from '../../lib/contract/adapter';

export type SubtitlePhase = 'start' | 'response' | 'end';

export type SegmentSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed'>;

interface SideState {
  /** Allocated at `Start` (or the first text), released at `End`. */
  ref: Ref | null;
  opened: boolean;
  /** What was last sent for `ref`. */
  text: string;
  /** Every `Response` piece since the side's last `Start` or `End`, joined as it came. */
  pieces: string;
}

const idle = (): SideState => ({ ref: null, opened: false, text: '', pieces: '' });

export class Ast2Segments {
  private next: Ref = 1;
  private readonly sides: Record<Side, SideState> = { source: idle(), translation: idle() };
  private lastTranslation: Ref | undefined;

  constructor(private readonly sink: SegmentSink) {}

  /**
   * One subtitle message; answers the ref the message belongs to — null
   * when it has none — for the adapter's frame.
   * - `start`: the previous segment of the side closes as it stands (its
   *   `End` never came) or, never shown, is dropped; a ref is allocated,
   *   and nothing is emitted until text arrives.
   * - `response`: one piece, added to the pieces before it; their join is
   *   the text shown (Gemini/AST2 follow-up, choice 1). Pieces with no
   *   `Start` allocate once, not once per frame (survey §1.18.3); while the
   *   join is empty or blank, nothing is shown.
   * - `end`: the whole text, then the close. An empty or blank `End` of a
   *   segment never shown is the server VAD's false start: nothing; of one
   *   shown, it closes with the text it had (survey §1.18.4).
   */
  subtitle(side: Side, phase: SubtitlePhase, text: string): Ref | null {
    const state = this.sides[side];
    if (phase === 'start') {
      this.finish(side);
      state.ref = this.next++;
      return state.ref;
    }
    if (phase === 'response') state.pieces += text;
    const whole = phase === 'end' ? text : state.pieces;
    // Blank counts as empty, as the old client's false-start test did
    // (`!text.trim()`, `VolcengineAST2Client.ts:738-743, 814-819`); the text
    // shown is still the one sent, untrimmed.
    if (whole.trim()) this.show(side, whole);
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
