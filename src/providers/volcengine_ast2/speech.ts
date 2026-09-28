/**
 * Doubao's spoken sentences (ruling 10; survey §1.8): the `TTSResponse`
 * chunks between `TTSSentenceStart` and `TTSSentenceEnd` are one Ogg Opus
 * clip, decoded whole and emitted as one rangeless `audio` — replay, no
 * karaoke — on the translation it was locked to when the sentence started.
 * Decodes run one after another, so clips arrive in order; the old client's
 * two races are not ported: it read its target after the decode's `await`,
 * and let decodes overtake (survey §1.18.2). Pure: the decoder is injected.
 */
import type { AdapterEvents, Ref } from '../../lib/contract/adapter';
import { describeCause } from '../../lib/diagnostics/describeCause';

/** A clip's Ogg Opus as the contract's 24 kHz mono Int16. */
export type OggDecoder = (ogg: Uint8Array) => Promise<Int16Array>;

export type SpeechSink = Pick<AdapterEvents, 'audio' | 'degraded'>;

export class Ast2Speech {
  private chunks: Uint8Array[] = [];
  private ref: Ref | undefined;
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly decode: OggDecoder, private readonly sink: SpeechSink) {}

  /** `TTSSentenceStart`: the sentence belongs to `ref` (the translation started now, shown or not, else the last one shown), locked now. A sentence left unended is flushed first. */
  sentenceStart(ref: Ref | undefined): void {
    this.flush();
    this.ref = ref;
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
    const ref = this.ref;
    this.chain = this.chain
      // A clip still waiting when the session stops is never decoded: the empty pcm is dropped below.
      .then(() => (this.stopped ? new Int16Array(0) : this.decode(clip)))
      .then(
        (pcm) => { if (!this.stopped && pcm.length > 0) this.sink.audio(ref === undefined ? { pcm } : { pcm, ref }); },
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
}
