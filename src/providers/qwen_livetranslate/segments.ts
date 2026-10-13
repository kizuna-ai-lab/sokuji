/**
 * Qwen LiveTranslate's events → segments (spec 2026-10-13, §6). The server
 * cuts the turns (`boundaries: 'provider'`); this only names them. Each turn
 * is two items: the heard one (`speech_started` under automatic turns, its
 * `conversation.item.created` with input audio under push-to-talk) and the
 * translation, whose `conversation.item.created` names the heard item as
 * `previous_item_id`: the heard item's id is the origin both sides state.
 * Deltas append and each sends the whole text, trimmed; a `.completed` /
 * `.done` replaces it and closes. A segment opens with its first words or
 * audio, so an empty turn shows nothing. On the participant leg (D7) the
 * heard item's `speaker_id` labels both sides. A cancelled turn closes what
 * it holds and hears nothing more. Pure: no socket, no timer.
 *
 * Karaoke (owner's choice A, 2026-10-14): a translation arrives as phrases,
 * each its words and then their speech, and in every recorded turn a
 * phrase's share of the text matched its share of the audio within 5%. So
 * words after audio begin the next phrase, and the phrase before is tiled
 * over the audio that followed it, by samples (`speechRanges`, Palabra's
 * fill-in); the last phrase once both its final text and `response.audio.done`
 * have come. Nothing is lit before its phrase is whole.
 */
import type { AdapterEvents, Ref, Side, TextRange } from '../../lib/contract/adapter';
import { tileSpan } from '../../lib/contract/ranges';

export interface QwenSegmentsOptions {
  sink: Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'audio' | 'speechRanges'>;
  /** Label each turn with its speaker (D7): the participant leg only. */
  person: boolean;
}

interface Item {
  side: Side;
  /** A translation's heard item, once named. */
  source?: string;
  /** Set when the segment opens, with its first words or audio. */
  ref?: Ref;
  /** Everything heard so far, and the trimmed snapshot last sent. */
  text: string;
  shown: string;
  /** The translation opened stating its origin. */
  stated: boolean;
  closed: boolean;
  /** Cancelled: nothing more of it is heard, its audio included. */
  dropped: boolean;
  /** The push-to-talk turn it was first seen in: a cancel drops the current turn's items, never a committed turn's. */
  turn: number;
  /** A translation's speech: each `audio` entry's sample count, in order, the index `speechRanges` names. */
  samples: number[];
  /** Where the current phrase begins: in the snapshot, and among the entries. */
  phraseText: number;
  phraseAudio: number;
  /** The ranges stated so far, by entry: restated when the final text is shorter. */
  ranges: Map<number, TextRange>;
  /** `response.audio.done` came: no more speech is expected. */
  spoken: boolean;
}

export class QwenSegments {
  private nextRef = 1;
  private readonly items = new Map<string, Item>();
  /** `speaker_id` by heard item, from `speech_started` (automatic turns only). */
  private readonly speakers = new Map<string, string>();
  private stopped = false;
  /** The current push-to-talk turn: a confirmed commit or clear starts the next. */
  private turn = 0;
  /** A cancel's clear is not confirmed yet: whatever the server still sends for that turn is dropped as it comes. */
  private suppressing = false;

  constructor(private readonly o: QwenSegmentsOptions) {}

  /** A heard item begins, with its speaker when told. */
  heard(itemId: string, speaker: number | null = null): void {
    if (speaker !== null) this.speakers.set(itemId, String(speaker));
    this.item(itemId, 'source');
  }

  /**
   * A `conversation.item.created`: heard when its content is input audio. When
   * the content does not say — push-to-talk names no speech start, and no
   * recording shows its heard item — by what it follows: a translation always
   * follows its heard item, and a heard item follows nothing or the last
   * translation.
   */
  created(itemId: string, o: { inputAudio: boolean; previous: string | null }): void {
    const before = o.previous === null ? undefined : this.items.get(o.previous);
    if (o.inputAudio || o.previous === null || before?.side === 'translation') this.heard(itemId);
    else this.answer(itemId, o.previous);
  }

  /** A translation item, with the heard item it follows when told. The answer to a cancelled turn is cancelled with it. */
  answer(itemId: string, previous: string | null = null): void {
    const it = this.item(itemId, 'translation');
    if (!it || previous === null || it.source !== undefined) return;
    const heard = this.items.get(previous);
    if (heard?.side !== 'source') return;
    it.source = previous;
    if (heard.dropped && !it.closed) this.drop(it);
  }

  text(itemId: string, side: Side, delta: string): void {
    const it = this.item(itemId, side);
    if (!it || it.closed) return;
    // Words after the phrase's audio begin the next phrase: the one before is whole. A blank delta adds no word.
    if (side === 'translation' && delta.trim() !== '' && it.samples.length > it.phraseAudio && it.shown.length > it.phraseText) this.fill(it);
    it.text += delta;
    this.show(itemId, it);
  }

  /** The final text replaces what the deltas built, unless it is empty; then the segment closes. */
  done(itemId: string, side: Side, final: string | null): void {
    const it = this.item(itemId, side);
    if (!it || it.closed) return;
    if (final !== null && final.trim() !== '') it.text = final;
    this.show(itemId, it);
    this.restate(it);
    this.close(it);
    this.finish(it);
  }

  /** Translated speech, in its translation's segment — after that segment's text closed too. */
  audio(itemId: string, pcm: Int16Array): void {
    const it = this.item(itemId, 'translation');
    if (!it || it.dropped) return;
    if (it.ref === undefined) {
      // A translation that closed empty has no segment to hold it.
      if (it.closed) return;
      this.open(itemId, it);
    }
    this.o.sink.audio({ pcm, ref: it.ref });
    it.samples.push(pcm.length);
  }

  /** `response.audio.done`: the translation's speech is all here; its last phrase is filled once its text is final too. */
  audioDone(itemId: string): void {
    const it = this.item(itemId, 'translation');
    if (!it || it.spoken) return;
    it.spoken = true;
    this.finish(it);
  }

  /**
   * A push-to-talk cancel: the server never finishes that response, so what
   * the turn has open closes here, and what it still sends for the turn —
   * items not even seen yet when a press is that short — is dropped until
   * the server confirms the clear. A committed turn's translation still
   * arriving is left alone.
   */
  cancel(): void {
    for (const it of this.items.values()) if (!it.closed && it.turn === this.turn) this.drop(it);
    this.suppressing = true;
  }

  /** `input_audio_buffer.committed`: the turn is the server's to finish; the next begins. Also ends a suppression whose clear was never confirmed. */
  committed(): void {
    this.turn += 1;
    this.suppressing = false;
  }

  /** `input_audio_buffer.cleared`: everything the cancelled turn sent has arrived; the next turn begins. */
  cleared(): void {
    this.turn += 1;
    this.suppressing = false;
  }

  stop(): void {
    this.stopped = true;
  }

  /** The item by id, made at its first mention; null after stop, or for an id named for the other side (a malformed event). */
  private item(itemId: string, side: Side): Item | null {
    if (this.stopped) return null;
    let it = this.items.get(itemId);
    if (!it) {
      // First seen after a cancel and before its clear is confirmed: the cancelled turn's, dropped as it comes.
      const dropped = this.suppressing;
      it = { side, text: '', shown: '', stated: false, closed: dropped, dropped, turn: this.turn, samples: [], phraseText: 0, phraseAudio: 0, ranges: new Map(), spoken: false };
      this.items.set(itemId, it);
    }
    return it.side === side ? it : null;
  }

  /** The snapshot, when it changed: a segment opens with its first words, so blank text opens nothing. */
  private show(itemId: string, it: Item): void {
    const text = it.text.trim();
    if (text === it.shown) return;
    if (it.ref === undefined) this.open(itemId, it);
    it.shown = text;
    const ref = it.ref as Ref;
    const person = this.person(itemId, it);
    this.o.sink.segmentText(person === undefined ? { ref, text } : { ref, text, person });
  }

  private open(itemId: string, it: Item): void {
    const ref = this.nextRef++;
    it.ref = ref;
    const origin = it.side === 'source' ? itemId : it.source;
    it.stated = origin !== undefined;
    const person = this.person(itemId, it);
    this.o.sink.segmentOpened({ ref, side: it.side, ...(origin === undefined ? {} : { origin }), ...(person === undefined ? {} : { person }) });
  }

  private close(it: Item): void {
    it.closed = true;
    if (it.ref === undefined) return;
    // A translation that opened before its heard item was named states its origin now.
    this.o.sink.segmentClosed(!it.stated && it.source !== undefined ? { ref: it.ref, origin: it.source } : { ref: it.ref });
  }

  /** The current phrase's text, tiled over its audio by samples; the next phrase begins after both. A phrase with no words or no audio states nothing. */
  private fill(it: Item): void {
    const end = it.shown.length;
    const span: TextRange = [Math.min(it.phraseText, end), end];
    const samples = it.samples.slice(it.phraseAudio);
    if (it.ref !== undefined && samples.length > 0 && span[1] > span[0]) {
      const ranges = tileSpan(span, samples, it.shown).map((range, k) => ({ index: it.phraseAudio + k, range }));
      for (const { index, range } of ranges) it.ranges.set(index, range);
      this.o.sink.speechRanges({ ref: it.ref, ranges });
    }
    it.phraseText = end;
    it.phraseAudio = it.samples.length;
  }

  /** The last phrase, once the text is final and the speech all here. */
  private finish(it: Item): void {
    if (it.side === 'translation' && it.closed && it.spoken && !it.dropped) this.fill(it);
  }

  /** A final text shorter than its deltas: the ranges past its end, stated again within it. */
  private restate(it: Item): void {
    const end = it.shown.length;
    const past = [...it.ranges].filter(([, range]) => range[1] > end).map(([index, range]) => ({ index, range: [Math.min(range[0], end), end] as TextRange }));
    if (it.ref === undefined || past.length === 0) return;
    for (const { index, range } of past) it.ranges.set(index, range);
    this.o.sink.speechRanges({ ref: it.ref, ranges: past });
  }

  private drop(it: Item): void {
    it.dropped = true;
    this.close(it);
  }

  private person(itemId: string, it: Item): string | undefined {
    if (!this.o.person) return undefined;
    const heard = it.side === 'source' ? itemId : it.source;
    return heard === undefined ? undefined : this.speakers.get(heard);
  }
}
