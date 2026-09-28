/**
 * Doubao's spoken sentences (ruling 10; survey §1.8): the `TTSResponse`
 * chunks between `TTSSentenceStart` and `TTSSentenceEnd` are one Ogg Opus
 * clip, decoded whole and emitted as one `audio`. The sentence is taken
 * when it starts — the lock read then, and its server times; its
 * translation and range are asked for when the clip is emitted, after its
 * decode (Gemini/AST2 follow-up, choices 2, 4): the translation its times
 * name, else the lock's; the whole translation's range when the times named
 * it and its text is final, else none — replay only. Decodes run one after
 * another, so clips arrive in order; the old client's two races are not
 * ported: it read its lock after the decode's `await`, and let decodes
 * overtake (survey §1.18.2). The lock is read at the start here; only the
 * times, which name one subtitle whatever opened since, wait for the
 * decode. Pure: the decoder and the resolution are injected.
 */
import type { AdapterEvents } from '../../lib/contract/adapter';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { Clip, Sentence } from './segments';

/** A clip's Ogg Opus as the contract's 24 kHz mono Int16. */
export type OggDecoder = (ogg: Uint8Array) => Promise<Int16Array>;

export type SpeechSink = Pick<AdapterEvents, 'audio' | 'degraded'>;

/** A clip's translation and range, asked for as the clip is emitted (`Ast2Segments.clipFor`). */
export type ClipFor = (sentence: Sentence) => Clip | undefined;

/** With nothing to match against: the lock's translation, rangeless. */
const toLock: ClipFor = (sentence) => (sentence.lock === undefined ? undefined : { ref: sentence.lock, matched: false });

export class Ast2Speech {
  private chunks: Uint8Array[] = [];
  private sentence: Sentence | undefined;
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly decode: OggDecoder, private readonly sink: SpeechSink, private readonly clipFor: ClipFor = toLock) {}

  /** `TTSSentenceStart`: the sentence as it starts (`Ast2Segments.sentence`), taken now. A sentence left unended is flushed first. */
  sentenceStart(sentence: Sentence): void {
    this.flush();
    this.sentence = sentence;
  }

  /** `TTSResponse`: a copy — the codec's `data` is a view into its decode buffer (`VolcengineAST2Client.ts:877-885`). */
  chunk(data: Uint8Array): void {
    // `new Uint8Array(view)` copies; a Node `Buffer` view's own `slice` would not.
    if (data.length > 0) this.chunks.push(new Uint8Array(data));
  }

  /** `TTSSentenceEnd`, or `TTSEnded` for what is left: the clip goes to the decoder; answers what it held, for the adapter's frame — nothing once stopped. */
  flush(): { chunks: number; bytes: number } {
    const held = this.chunks;
    this.chunks = [];
    if (this.stopped) return { chunks: 0, bytes: 0 };
    const bytes = held.reduce((n, c) => n + c.length, 0);
    if (bytes === 0) return { chunks: 0, bytes: 0 };
    const clip = new Uint8Array(bytes);
    let at = 0;
    for (const c of held) { clip.set(c, at); at += c.length; }
    const sentence = this.sentence;
    this.chain = this.chain
      // A clip still waiting when the session stops is never decoded: the empty pcm is dropped below.
      .then(() => (this.stopped ? new Int16Array(0) : this.decode(clip)))
      .then(
        (pcm) => { if (!this.stopped && pcm.length > 0) this.emit(pcm, sentence); },
        (error: unknown) => {
          if (!this.stopped) this.sink.degraded({ code: 'tts_degraded', message: `A spoken sentence from Doubao could not be decoded: ${describeCause(error)}`, cause: error, reason: 'tts_decode' });
        },
      );
    return { chunks: held.length, bytes };
  }

  /** Stop, a failure or a close: nothing more is decoded or emitted — a decode already running finishes, and its result is dropped. */
  stop(): void {
    this.stopped = true;
    this.chunks = [];
  }

  /** The translation and range are asked for here, as the clip reaches L1, never before: during the decode its subtitle may have started, or become final. A clip with no sentence — chunks before any start — goes nowhere. */
  private emit(pcm: Int16Array, sentence: Sentence | undefined): void {
    const clip = sentence === undefined ? undefined : this.clipFor(sentence);
    if (clip === undefined) {
      this.sink.audio({ pcm });
      return;
    }
    this.sink.audio(clip.range ? { pcm, ref: clip.ref, range: clip.range } : { pcm, ref: clip.ref });
  }
}
