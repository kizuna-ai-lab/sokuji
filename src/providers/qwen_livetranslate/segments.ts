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
 * heard item's `speaker_id` labels both sides. A push-to-talk cancel is a
 * release (the adapter commits it), so nothing here drops a turn. Pure: no
 * socket, no timer.
 *
 * Karaoke (owner's choice A, 2026-10-14): a translation arrives as phrases,
 * each its words and then their speech, and in every recorded turn a
 * phrase's share of the text matched its share of the audio within 5%. So
 * words after audio begin the next phrase, and the phrase before is tiled
 * over the audio that followed it, by samples (`speechRanges`, Palabra's
 * fill-in); the last phrase once both its final text and `response.audio.done`
 * have come. Until then each chunk carries a provisional range, the phrase's
 * words reached at the speech rate the fill-ins measured (karaoke
 * provisional ranges design), which the fill-in replaces.
 */
import type { AdapterEvents, Ref, Side, TextRange } from '../../lib/contract/adapter';
import { SpeechPace, tileSpan } from '../../lib/contract/ranges';

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
  /** A translation's speech: each `audio` entry's sample count, in order, the index `speechRanges` names. */
  samples: number[];
  /** Where the current phrase begins: in the snapshot, and among the entries. */
  phraseText: number;
  phraseAudio: number;
  /** The ranges stated so far, by entry: restated when the final text is shorter. */
  ranges: Map<number, TextRange>;
  /** `response.audio.done` came: no more speech is expected. */
  spoken: boolean;
  /** The current phrase's samples so far, and where its provisional ranges reached, from the phrase's start. */
  cum: number;
  reached: number;
}

export class QwenSegments {
  private nextRef = 1;
  private readonly items = new Map<string, Item>();
  /** `speaker_id` by heard item, from `speech_started` (automatic turns only). */
  private readonly speakers = new Map<string, string>();
  private stopped = false;
  /** The leg's speech rate, learned from its fill-ins. */
  private readonly pace = new SpeechPace();

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

  /** A translation item, with the heard item it follows when told. */
  answer(itemId: string, previous: string | null = null): void {
    const it = this.item(itemId, 'translation');
    if (!it || previous === null || it.source !== undefined) return;
    const heard = this.items.get(previous);
    if (heard?.side !== 'source') return;
    it.source = previous;
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
    if (!it) return;
    if (it.ref === undefined) {
      // A translation that closed empty has no segment to hold it.
      if (it.closed) return;
      this.open(itemId, it);
    }
    // Once the last phrase is filled (text final, speech all here), a stray chunk plays unranged, as before.
    const range = it.closed && it.spoken ? undefined : this.provisional(it, pcm.length);
    this.o.sink.audio(range ? { pcm, ref: it.ref, range } : { pcm, ref: it.ref });
    it.samples.push(pcm.length);
  }

  /** `response.audio.done`: the translation's speech is all here; its last phrase is filled once its text is final too. */
  audioDone(itemId: string): void {
    const it = this.item(itemId, 'translation');
    if (!it || it.spoken) return;
    it.spoken = true;
    this.finish(it);
  }

  stop(): void {
    this.stopped = true;
  }

  /** The item by id, made at its first mention; null after stop, or for an id named for the other side (a malformed event). */
  private item(itemId: string, side: Side): Item | null {
    if (this.stopped) return null;
    let it = this.items.get(itemId);
    if (!it) {
      it = { side, text: '', shown: '', stated: false, closed: false, samples: [], phraseText: 0, phraseAudio: 0, ranges: new Map(), spoken: false, cum: 0, reached: 0 };
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
      this.pace.learn(it.shown.slice(span[0], span[1]), samples.reduce((n, s) => n + s, 0));
    }
    it.phraseText = end;
    it.phraseAudio = it.samples.length;
    it.cum = 0;
    it.reached = 0;
  }

  /**
   * Where this chunk reaches in the current phrase's words, at the leg's rate,
   * recorded so a shorter final text restates it too; none while the phrase
   * has no letters. A phrase is the shown words since the last fill, as the
   * chunk arrives: audio before any words joins the first phrase, whose words
   * then grow it.
   */
  private provisional(it: Item, samples: number): TextRange | undefined {
    const start = Math.min(it.phraseText, it.shown.length);
    const phrase = it.shown.slice(start);
    it.cum += samples;
    // A shorter final text can leave the phrase shorter than what was reached; restate already pulled those ranges inside it.
    const from = Math.min(it.reached, phrase.length);
    const end = this.pace.reach(phrase, it.cum, from);
    if (end === null) return undefined;
    const range: TextRange = [start + from, start + end];
    it.ranges.set(it.samples.length, range);
    it.reached = end;
    return range;
  }

  /** The last phrase, once the text is final and the speech all here. */
  private finish(it: Item): void {
    if (it.side === 'translation' && it.closed && it.spoken) this.fill(it);
  }

  /** A final text shorter than its deltas: the ranges past its end, stated again within it. */
  private restate(it: Item): void {
    const end = it.shown.length;
    const past = [...it.ranges].filter(([, range]) => range[1] > end).map(([index, range]) => ({ index, range: [Math.min(range[0], end), end] as TextRange }));
    if (it.ref === undefined || past.length === 0) return;
    for (const { index, range } of past) it.ranges.set(index, range);
    this.o.sink.speechRanges({ ref: it.ref, ranges: past });
  }

  private person(itemId: string, it: Item): string | undefined {
    if (!this.o.person) return undefined;
    const heard = it.side === 'source' ? itemId : it.source;
    return heard === undefined ? undefined : this.speakers.get(heard);
  }
}
