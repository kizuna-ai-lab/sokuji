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
 */
import type { AdapterEvents, Ref, Side } from '../../lib/contract/adapter';

export interface QwenSegmentsOptions {
  sink: Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'audio'>;
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
}

export class QwenSegments {
  private nextRef = 1;
  private readonly items = new Map<string, Item>();
  /** `speaker_id` by heard item, from `speech_started` (automatic turns only). */
  private readonly speakers = new Map<string, string>();
  private stopped = false;

  constructor(private readonly o: QwenSegmentsOptions) {}

  /** A heard item begins, with its speaker when told. */
  heard(itemId: string, speaker: number | null = null): void {
    if (speaker !== null) this.speakers.set(itemId, String(speaker));
    this.item(itemId, 'source');
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
    it.text += delta;
    this.show(itemId, it);
  }

  /** The final text replaces what the deltas built, unless it is empty; then the segment closes. */
  done(itemId: string, side: Side, final: string | null): void {
    const it = this.item(itemId, side);
    if (!it || it.closed) return;
    if (final !== null && final.trim() !== '') it.text = final;
    this.show(itemId, it);
    this.close(it);
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
  }

  /** A push-to-talk cancel: the server never finishes that response, so what is open closes here. */
  cancel(): void {
    for (const it of this.items.values()) if (!it.closed) this.drop(it);
  }

  stop(): void {
    this.stopped = true;
  }

  /** The item by id, made at its first mention; null after stop, or for an id named for the other side (a malformed event). */
  private item(itemId: string, side: Side): Item | null {
    if (this.stopped) return null;
    let it = this.items.get(itemId);
    if (!it) {
      it = { side, text: '', shown: '', stated: false, closed: false, dropped: false };
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
