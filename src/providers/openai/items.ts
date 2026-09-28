/**
 * OpenAI Realtime's conversation items → segments (survey §2.11): the old
 * client's items (`OpenAIGAClient.ts:476-707`) as a pure machine. No timer:
 * the server's own events open and close every segment.
 *
 * - **Sources.** Every input item is a source segment whose origin is the
 *   item's id: a commit's (automatic or manual) opens it empty — no row
 *   until it has text — its transcript deltas stream into it (ruling 11)
 *   and the completed transcript settles and closes it; a typed text is
 *   opened, written and closed at once, under the adapter's own item id.
 * - **Translations, paired exactly** (choice 8): a response's assistant item
 *   is a translation segment whose origin is the input its
 *   `previous_item_id` names, when this leg opened that input; else, taken
 *   as the response was created, the newest input the server holds if it is
 *   still unanswered — never an older, still-unanswered one behind it —
 *   else none. An input no response ever answers — an utterance spoken over
 *   a playing translation, which the server may leave unanswered under
 *   `interrupt_response: false` — stays a source row of its own.
 * - **Karaoke by arrival** (ruling 3): a played frame carries
 *   `[the previous played frame's end, the translation's length when the
 *   frame arrived]`, OpenAI Translate's alignment (its choice 6). When the
 *   final text settles shorter — trimmed, unwrapped — the ranges past its
 *   end are stated again within it (`speechRanges`, choice 9).
 * - **Out of band** (the drift anchor, ruling 2): a response kept out of the
 *   conversation makes no segment.
 */
import type { AdapterEvents, Ref, TextRange } from '../../lib/contract/adapter';

export type ItemSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'audio' | 'speechRanges'>;

interface Input {
  ref: Ref;
  text: string;
  closed: boolean;
  /** The server holds the item: a commit's, or a typed item the server has added. A typed text still waiting is no one's origin by default. */
  known: boolean;
  /** A translation named it as its origin. */
  answered: boolean;
}

interface Output {
  ref: Ref;
  text: string;
  /** Where the last played frame's range ended (ruling 3). */
  spoken: number;
  /** Every played frame's range, in order: the ref's audio entries, re-stated when the final text is shorter (choice 9). */
  ranges: TextRange[];
  closed: boolean;
}

interface ResponseState {
  outOfBand: boolean;
  /** The newest known input, taken when the response was created, if it was still unanswered then: the origin when its item names none (choice 8). */
  fallback?: string;
}

export class RealtimeItems {
  private refs = 0;
  /** By item id, in the order they opened. */
  private readonly inputs = new Map<string, Input>();
  private readonly outputs = new Map<string, Output>();
  private readonly responses = new Map<string, ResponseState>();
  /** An assistant item's response, from `response.output_item.added`. */
  private readonly owners = new Map<string, string>();
  private stopped = false;

  constructor(private readonly sink: ItemSink) {}

  /** An input item exists — a VAD or a manual commit (`input_audio_buffer.committed`). */
  committed(itemId: string): void {
    if (this.stopped || this.inputs.has(itemId)) return;
    this.openInput(itemId, true);
  }

  /** Typed text, shown at once, before its item goes up (spec: "`appendText` is answered by the adapter"). */
  typed(itemId: string, text: string): void {
    if (this.stopped || this.inputs.has(itemId)) return;
    const input = this.openInput(itemId, false);
    input.text = text;
    this.sink.segmentText({ ref: input.ref, text });
    this.closeInput(input);
  }

  /** The server added an input item (`conversation.item.added`, role user): a typed text reached it. */
  inputAdded(itemId: string): void {
    const input = this.inputs.get(itemId);
    if (input) input.known = true;
  }

  /** A transcript delta for an input (ruling 11). */
  inputDelta(itemId: string, delta: string): void {
    const input = this.input(itemId);
    if (!input || !delta) return;
    input.text += delta;
    this.sink.segmentText({ ref: input.ref, text: input.text });
  }

  /** The input's transcript, completed: it settles the text and closes the source. An empty completion is no answer — the same rule `outputDone` keeps — so streamed text survives it; with none streamed, the source closes with none. */
  inputDone(itemId: string, transcript: string): void {
    const input = this.input(itemId);
    if (!input) return;
    if (transcript && transcript !== input.text) {
      input.text = transcript;
      this.sink.segmentText({ ref: input.ref, text: transcript });
    }
    this.closeInput(input);
  }

  /** The input's transcription failed: the source closes as it stands. */
  inputFailed(itemId: string): void {
    const input = this.inputs.get(itemId);
    if (input && !input.closed && !this.stopped) this.closeInput(input);
  }

  /** A response began: out of band (the anchor's) it will make no segment; in band it takes its fallback origin now. */
  responseCreated(responseId: string, outOfBand: boolean): void {
    if (this.stopped) return;
    this.responses.set(responseId, outOfBand ? { outOfBand } : { outOfBand, fallback: this.newestUnanswered() });
  }

  /** A response's output item (`response.output_item.added`): its owner, so its announcement finds the fallback. */
  outputAdded(itemId: string, responseId: string): void {
    this.owners.set(itemId, responseId);
  }

  /**
   * A response's assistant item, announced (`conversation.item.added`): its translation opens, paired by the input it follows (choice 8).
   * Announced before its output item, its owner is the one in-band response still running — none is guessed between two — so the fallback still finds it.
   */
  assistantAdded(itemId: string, previousItemId: string | null | undefined): void {
    if (this.stopped) return;
    if (!this.owners.has(itemId)) {
      const running = [...this.responses].filter(([, r]) => !r.outOfBand).map(([responseId]) => responseId);
      if (running.length === 1) this.owners.set(itemId, running[0]);
    }
    if (this.outOfBand(this.owners.get(itemId))) return;
    this.output(itemId, previousItemId);
  }

  /** A transcript or text delta of a translation. */
  outputDelta(itemId: string, responseId: string, delta: string): void {
    if (this.stopped || !delta || this.outOfBand(responseId)) return;
    this.owners.set(itemId, responseId);
    const out = this.output(itemId);
    if (!out) return;
    out.text += delta;
    this.sink.segmentText({ ref: out.ref, text: out.text });
  }

  /** The translation's final text (already trimmed and unwrapped): it replaces the streamed one, and ranges past its end are stated again within it (choice 9). */
  outputDone(itemId: string, responseId: string, text: string): void {
    if (this.stopped || this.outOfBand(responseId)) return;
    this.owners.set(itemId, responseId);
    const out = this.output(itemId);
    if (!out || !text || text === out.text) return;
    out.text = text;
    this.sink.segmentText({ ref: out.ref, text });
    const len = text.length;
    const restated = out.ranges.flatMap((range, index) => {
      if (range[1] <= len) return [];
      const inside: TextRange = [Math.min(range[0], len), len];
      out.ranges[index] = inside;
      return [{ index, range: inside }];
    });
    out.spoken = Math.min(out.spoken, len);
    if (restated.length > 0) this.sink.speechRanges({ ref: out.ref, ranges: restated });
  }

  /** Audio of a translation, played (the adapter drops it on a leg that does not speak): ranged by arrival under its segment (ruling 3). */
  audio(itemId: string, responseId: string, pcm: Int16Array): void {
    if (this.stopped || pcm.length === 0 || this.outOfBand(responseId)) return;
    this.owners.set(itemId, responseId);
    const out = this.output(itemId);
    // Its translation already closed: it plays, and is no row's.
    if (!out) {
      this.sink.audio({ pcm });
      return;
    }
    const range: TextRange = [out.spoken, out.text.length];
    out.ranges.push(range);
    out.spoken = range[1];
    this.sink.audio({ pcm, ref: out.ref, range });
  }

  /** The output item is done (`response.output_item.done`): its translation closes. */
  itemDone(itemId: string): void {
    const out = this.outputs.get(itemId);
    if (out && !out.closed && !this.stopped) this.closeOutput(out);
  }

  /** The response is done (`response.done`, whatever its status): every translation of it still open closes. */
  responseDone(responseId: string): void {
    if (this.stopped) return;
    for (const [itemId, owner] of this.owners) {
      if (owner !== responseId) continue;
      const out = this.outputs.get(itemId);
      if (out && !out.closed) this.closeOutput(out);
      this.owners.delete(itemId);
    }
    this.responses.delete(responseId);
  }

  /** Nothing after stop: L1 finalizes what is open. */
  stop(): void {
    this.stopped = true;
  }

  private outOfBand(responseId: string | undefined): boolean {
    return responseId !== undefined && this.responses.get(responseId)?.outOfBand === true;
  }

  private openInput(itemId: string, known: boolean): Input {
    const ref = ++this.refs;
    this.sink.segmentOpened({ ref, side: 'source', origin: itemId });
    const input: Input = { ref, text: '', closed: false, known, answered: false };
    this.inputs.set(itemId, input);
    return input;
  }

  private closeInput(input: Input): void {
    input.closed = true;
    this.sink.segmentClosed({ ref: input.ref });
  }

  /** An open input, opened now if the server names one this leg never saw committed; null once closed. */
  private input(itemId: string): Input | null {
    if (this.stopped) return null;
    const input = this.inputs.get(itemId) ?? this.openInput(itemId, true);
    return input.closed ? null : input;
  }

  /** An open translation, opened now with its origin; null once closed. */
  private output(itemId: string, previousItemId?: string | null): Output | null {
    const known = this.outputs.get(itemId);
    if (known) return known.closed ? null : known;
    const origin = this.originFor(itemId, previousItemId);
    const ref = ++this.refs;
    this.sink.segmentOpened({ ref, side: 'translation', ...(origin ? { origin } : {}) });
    const out: Output = { ref, text: '', spoken: 0, ranges: [], closed: false };
    this.outputs.set(itemId, out);
    return out;
  }

  private closeOutput(out: Output): void {
    out.closed = true;
    this.sink.segmentClosed({ ref: out.ref });
  }

  /** The input this translation follows, stated by the server when it names one of ours; else its response's fallback (choice 8). */
  private originFor(itemId: string, previousItemId: string | null | undefined): string | undefined {
    const origin = previousItemId && this.inputs.has(previousItemId)
      ? previousItemId
      : this.responses.get(this.owners.get(itemId) ?? '')?.fallback;
    const input = origin === undefined ? undefined : this.inputs.get(origin);
    if (input) input.answered = true;
    return origin;
  }

  /** The newest known input — never an older, still-unanswered one behind it — if that newest one is itself unanswered; else none (choice 8). */
  private newestUnanswered(): string | undefined {
    let newest: string | undefined;
    for (const [itemId, input] of this.inputs) if (input.known) newest = itemId;
    return newest !== undefined && !this.inputs.get(newest)!.answered ? newest : undefined;
  }
}
