import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Tokenizer } from '@huggingface/tokenizers';
import {
  boundedBatchEndSample,
  promoteQueued,
  QueuedUtterance,
  StreamingAudioFeed,
  StreamingTextAccumulator,
  tailPadSamples,
} from './streaming-generation';

// Captured at module scope: read lazily inside a test callback, import.meta.url
// resolves to a root-relative URL under this Vitest (harness-consolidation.test.ts).
const here = import.meta.url;

const f32 = (...values: number[]) => Float32Array.from(values);

describe('tailPadSamples', () => {
  // Voxtral Realtime: AUDIO_LENGTH_PER_TOK(8) * whisper hop_length(160).
  const RAW_AUDIO_LENGTH_PER_TOK = 1280;

  it('pads just past the model delay — about 560ms at 16kHz', () => {
    expect(tailPadSamples(RAW_AUDIO_LENGTH_PER_TOK) / 16000).toBeCloseTo(0.56, 2);
  });

  it('has nothing to pad when the token length is unknown', () => {
    expect(tailPadSamples(0)).toBe(0);
  });
});

describe('boundedBatchEndSample', () => {
  it('consumes aligned backlog without exceeding the per-call token cap', () => {
    expect(boundedBatchEndSample(1_000, 100_000, 1_280, 4)).toBe(4_840);
  });

  it('never extends past the available aligned samples', () => {
    expect(boundedBatchEndSample(1_000, 3_700, 1_280, 32)).toBe(3_560);
  });
});

describe('QueuedUtterance', () => {
  it('preserves an endpoint observed while the previous run is finishing', () => {
    const queued = new QueuedUtterance();
    queued.start();
    expect(queued.finish()).toBe(true);
    expect(queued.take()).toBe('finish');
    expect(queued.pending).toBe(false);
  });

  it('does not consume an endpoint when no utterance is queued', () => {
    const queued = new QueuedUtterance();
    expect(queued.finish()).toBe(false);
    expect(queued.take()).toBeNull();
  });

  it('keeps consecutive queued utterances and their endpoints distinct', () => {
    const queued = new QueuedUtterance();
    queued.start();
    queued.finish();
    queued.start();
    expect(queued.take()).toBe('finish');
    expect(queued.take()).toBe('open');
  });
});

describe('StreamingAudioFeed', () => {
  it('collects audio for the run that is currently generating', () => {
    const feed = new StreamingAudioFeed();
    feed.append(f32(1, 2));
    feed.append(f32(3));
    expect(Array.from(feed.audio)).toEqual([1, 2, 3]);
  });

  it('keeps only bounded recent audio while waiting for speech', () => {
    const feed = new StreamingAudioFeed();
    feed.append(f32(1, 2, 3));
    feed.append(f32(4, 5));
    feed.retainLatest(3);
    expect(Array.from(feed.audio)).toEqual([3, 4, 5]);
  });

  it('does not pad a short pre-roll up to its history limit', () => {
    const feed = new StreamingAudioFeed();
    feed.append(f32(1, 2));
    feed.retainLatest(4);
    expect(Array.from(feed.audio)).toEqual([1, 2]);
  });

  it('uses a safe finite bound for invalid history limits', () => {
    const feed = new StreamingAudioFeed();
    feed.append(f32(1, 2, 3));
    feed.retainLatest(Number.POSITIVE_INFINITY);
    expect(feed.audio.length).toBe(0);
  });

  it('pads the buffer with silence on finish so the model can decode its tail', () => {
    const feed = new StreamingAudioFeed();
    feed.append(f32(1, 2, 3));
    feed.requestFinish(2);
    expect(Array.from(feed.audio)).toEqual([1, 2, 3, 0, 0]);
  });

  it('stages audio arriving during a finish instead of extending the finishing run', () => {
    const feed = new StreamingAudioFeed();
    feed.append(f32(1));
    feed.requestFinish(0);
    feed.append(f32(9, 9));
    expect(Array.from(feed.audio)).toEqual([1]);
  });

  it('promotes staged audio on complete so the next utterance keeps its onset', () => {
    const feed = new StreamingAudioFeed();
    feed.append(f32(1));
    feed.requestFinish(0);
    feed.append(f32(9, 9));
    feed.complete();
    expect(Array.from(feed.audio)).toEqual([9, 9]);
    expect(feed.finishing).toBe(false);
  });

  it('keeps staged utterance boundaries distinct while an old run drains', () => {
    const feed = new StreamingAudioFeed();
    feed.append(f32(1));
    feed.requestFinish(0);
    feed.append(f32(2));
    feed.sealStaged();
    feed.append(f32(3));

    feed.complete();
    expect(Array.from(feed.audio)).toEqual([2]);
    feed.requestFinish(0);
    feed.complete();
    expect(Array.from(feed.audio)).toEqual([3]);
  });

  it('keeps consuming whole chunks after a finish until the padded audio runs out', () => {
    const feed = new StreamingAudioFeed();
    feed.append(new Float32Array(10));
    feed.requestFinish(4);            // 14 samples total
    expect(feed.hasSamples(14)).toBe(true);
    expect(feed.hasSamples(15)).toBe(false);
  });

  it('stops waiting for more audio once a finish is requested', () => {
    const feed = new StreamingAudioFeed();
    feed.append(new Float32Array(4));
    expect(feed.readyFor(100)).toBe(false);
    feed.requestFinish(0);
    expect(feed.readyFor(100)).toBe(true);
  });

  it('stages audio arriving after a stop so the next run still has its onset', () => {
    const feed = new StreamingAudioFeed();
    feed.append(f32(1));
    feed.requestStop();
    feed.append(f32(9, 9));
    expect(Array.from(feed.audio)).toEqual([1]);   // the abandoned run gains nothing
    feed.complete();
    expect(Array.from(feed.audio)).toEqual([9, 9]);
  });

  it('halts a run immediately on stop, even with audio still buffered', () => {
    const feed = new StreamingAudioFeed();
    feed.append(new Float32Array(100));
    feed.requestStop();
    expect(feed.stopped).toBe(true);
    expect(feed.readyFor(10)).toBe(true);
  });

  it('drops both buffers on clear', () => {
    const feed = new StreamingAudioFeed();
    feed.append(f32(1));
    feed.requestFinish(0);
    feed.append(f32(2));
    feed.clear();
    expect(feed.audio.length).toBe(0);
    feed.complete();
    expect(feed.audio.length).toBe(0);
  });
});

describe('promoteQueued', () => {
  /** Run 1 is draining its tail, so the worker queues every new utterance behind it. */
  function draining() {
    const feed = new StreamingAudioFeed();
    const queue = new QueuedUtterance();
    feed.append(f32(1));
    feed.requestFinish(0);
    return { feed, queue };
  }

  it('drops a queued misfire and promotes the utterance queued behind it', () => {
    const { feed, queue } = draining();
    queue.start();
    feed.append(f32(2));
    queue.stop();
    feed.sealStaged();
    queue.start();
    feed.append(f32(3, 3));
    queue.finish();
    feed.sealStaged();

    feed.complete();
    expect(promoteQueued(feed, queue)).toBe('finish');
    expect(Array.from(feed.audio)).toEqual([3, 3]);
    expect(queue.pending).toBe(false);
  });

  it('keeps the audio after a lone queued misfire as the next pre-roll', () => {
    const { feed, queue } = draining();
    queue.start();
    feed.append(f32(2));
    queue.stop();
    feed.sealStaged();
    feed.append(f32(7, 7));

    feed.complete();
    expect(promoteQueued(feed, queue)).toBeNull();
    expect(Array.from(feed.audio)).toEqual([7, 7]);
    expect(queue.pending).toBe(false);
  });

  it('skips consecutive misfires', () => {
    const { feed, queue } = draining();
    for (const v of [2, 3]) {
      queue.start();
      feed.append(f32(v));
      queue.stop();
      feed.sealStaged();
    }
    queue.start();
    feed.append(f32(4));

    feed.complete();
    expect(promoteQueued(feed, queue)).toBe('open');
    expect(Array.from(feed.audio)).toEqual([4]);
  });

  it('promotes queued utterances one run at a time, in order', () => {
    const { feed, queue } = draining();
    queue.start();
    feed.append(f32(2));
    queue.finish();
    feed.sealStaged();
    queue.start();
    feed.append(f32(3));

    feed.complete();
    expect(promoteQueued(feed, queue)).toBe('finish');
    expect(Array.from(feed.audio)).toEqual([2]);

    feed.requestFinish(0);
    feed.append(f32(3)); // the next utterance keeps talking while this one drains
    feed.complete();
    expect(promoteQueued(feed, queue)).toBe('open');
    expect(Array.from(feed.audio)).toEqual([3, 3]);
    expect(queue.pending).toBe(false);
  });

  it('pads a queued finish once, when it is promoted', () => {
    const { feed, queue } = draining();
    queue.start();
    feed.append(f32(2, 2));
    queue.finish();
    feed.sealStaged();

    feed.complete();
    expect(promoteQueued(feed, queue)).toBe('finish');
    feed.requestFinish(3); // the worker pads here, as it does for a run that was never queued
    expect(Array.from(feed.audio)).toEqual([2, 2, 0, 0, 0]);
  });

  it('leaves the feed alone when nothing is queued', () => {
    const { feed, queue } = draining();
    feed.append(f32(5));

    feed.complete();
    expect(promoteQueued(feed, queue)).toBeNull();
    expect(Array.from(feed.audio)).toEqual([5]);
  });
});

describe.each([false, true])('StreamingTextAccumulator (positionIndependentDecode: %s)', (positionIndependentDecode) => {
  /** Decodes each token id to a character code — enough to drive the accumulator. */
  const decode = (tokens: bigint[]) => tokens.map((t) => String.fromCharCode(Number(t))).join('');
  const tok = (text: string) => Array.from(text).map((c) => BigInt(c.charCodeAt(0)));

  function make(options: { punctuationEndpoint?: boolean } = {}) {
    const partials: string[] = [];
    const results: string[] = [];
    const acc = new StreamingTextAccumulator(decode, {
      onPartial: (t) => partials.push(t),
      onResult: (t) => results.push(t),
      punctuationEndpoint: options.punctuationEndpoint ?? true,
      positionIndependentDecode,
    });
    return { acc, partials, results };
  }

  it('emits the growing text as partials', () => {
    const { acc, partials } = make();
    acc.push(tok('ab'));
    acc.push(tok('cd'));
    expect(partials).toEqual(['ab', 'abcd']);
  });

  it('finalizes a sentence on terminal punctuation', () => {
    const { acc, results } = make();
    acc.push(tok('hi.'));
    expect(results).toEqual(['hi.']);
    acc.push(tok('yo'));
    expect(results).toEqual(['hi.']);
  });

  it('keeps accumulating past punctuation when the endpoint is disabled', () => {
    const { acc, results } = make({ punctuationEndpoint: false });
    acc.push(tok('hi.'));
    expect(results).toEqual([]);
  });

  it('holds back an incomplete multi-byte character', () => {
    const { acc, partials } = make();
    acc.push([...tok('ok'), BigInt(0xfffd)]);
    expect(partials).toEqual(['ok']);
  });

  it('flushes text the model already produced when the run ends', () => {
    const { acc, results } = make();
    acc.push(tok('tail'));
    acc.end();
    expect(results).toEqual(['tail']);
  });

  it('emits nothing more once the pending text has been flushed', () => {
    const { acc, results } = make();
    acc.push(tok('tail'));
    acc.end();
    acc.end();
    expect(results).toEqual(['tail']);
  });

  it('drops pending text when the run is discarded', () => {
    const { acc, results, partials } = make();
    acc.push(tok('gone'));
    acc.end({ discard: true });
    expect(results).toEqual([]);
    expect(partials).toEqual(['gone']);
  });

  it('starts clean after a discarded run', () => {
    const { acc, partials } = make();
    acc.push(tok('gone'));
    acc.end({ discard: true });
    acc.push(tok('new'));
    expect(partials).toEqual(['gone', 'new']);
  });
});

/**
 * The accumulator over a REAL byte-level tokenizer, built by the same library
 * transformers.js inlines, configured the way Voxtral's is: a ByteLevel
 * decoder with clean_up_tokenization_spaces off, specials skipped. Tokens are
 * arbitrary byte strings, so a test can put a character's bytes in two tokens,
 * or a whole character and the first bytes of the next one in the same token
 * — the "straddler" the real vocabulary has 730 of, and the only shape that
 * catches a window rebased at the wrong moment.
 */
describe('StreamingTextAccumulator over a real byte-level tokenizer', () => {
  /** GPT-2's byte-to-unicode table, which ByteLevel vocab strings are written in. */
  const BYTE_CHAR: string[] = (() => {
    const bs: number[] = [];
    for (let b = 0x21; b <= 0x7e; b++) bs.push(b);
    for (let b = 0xa1; b <= 0xac; b++) bs.push(b);
    for (let b = 0xae; b <= 0xff; b++) bs.push(b);
    const table: string[] = [];
    for (const b of bs) table[b] = String.fromCharCode(b);
    let n = 0;
    for (let b = 0; b < 256; b++) if (table[b] === undefined) table[b] = String.fromCharCode(256 + n++);
    return table;
  })();

  const PAD = 1n; // a special token, as Voxtral's [STREAMING_PAD]

  /** A tokenizer whose vocabulary is exactly these byte strings, from id 2 up. */
  function byteTokenizer(pieces: number[][]) {
    const vocab: Record<string, number> = { '<unk>': 0, '[STREAMING_PAD]': 1 };
    const idOf = new Map<string, bigint>();
    for (const bytes of pieces) {
      const key = bytes.join(',');
      if (idOf.has(key)) continue;
      const id = Object.keys(vocab).length;
      vocab[bytes.map((b) => BYTE_CHAR[b]).join('')] = id;
      idOf.set(key, BigInt(id));
    }
    const special = (id: number, content: string) => ({
      id, content, single_word: false, lstrip: false, rstrip: false, normalized: false, special: true,
    });
    const tokenizer = new Tokenizer(
      {
        version: '1.0', truncation: null, padding: null,
        added_tokens: [special(0, '<unk>'), special(1, '[STREAMING_PAD]')],
        normalizer: null,
        pre_tokenizer: { type: 'ByteLevel', add_prefix_space: false, trim_offsets: true, use_regex: true },
        post_processor: null,
        decoder: { type: 'ByteLevel', add_prefix_space: true, trim_offsets: true, use_regex: true },
        model: {
          type: 'BPE', dropout: null, unk_token: null, continuing_subword_prefix: null, end_of_word_suffix: null,
          fuse_unk: false, byte_fallback: false, ignore_merges: false, vocab, merges: [],
        },
      } as any,
      { clean_up_tokenization_spaces: false } as any,
    );
    // Exactly the worker's call. The library throws on an empty list, so an
    // accumulator that ever decodes an empty window fails every test here.
    const decode = (tokens: bigint[]) =>
      tokenizer.decode(tokens as any, { skip_special_tokens: true, clean_up_tokenization_spaces: null } as any);
    const id = (...bytes: number[]) => idOf.get(bytes.join(','))!;
    return { decode, id };
  }

  const utf8 = (text: string) => Array.from(new TextEncoder().encode(text));

  function run(
    decode: (tokens: bigint[]) => string,
    pushes: bigint[][],
    options: { positionIndependentDecode?: boolean } = {},
  ) {
    const partials: string[] = [];
    const results: string[] = [];
    const lengths: number[] = [];
    const acc = new StreamingTextAccumulator(
      (tokens) => { lengths.push(tokens.length); return decode(tokens); },
      {
        onPartial: (t) => partials.push(t),
        onResult: (t) => results.push(t),
        punctuationEndpoint: false,
        positionIndependentDecode: options.positionIndependentDecode ?? true,
      },
    );
    return { acc, partials, results, lengths, pushAll: () => pushes.forEach((p) => acc.push(p)) };
  }

  it('prints a character the moment its last byte arrives, even from a token that also starts the next one', () => {
    // [61 E5 9B] is "a" plus the first two bytes of 园 (E5 9B AD).
    const { decode, id } = byteTokenizer([[0x61, 0xe5, 0x9b], [0xad], [0x21]]);
    const r = run(decode, [[id(0x61, 0xe5, 0x9b)], [id(0xad)], [id(0x21)]]);
    r.pushAll();
    expect(r.partials).toEqual(['a', 'a园', 'a园!']);
  });

  it('joins a character whose bytes arrive around a special token', () => {
    const { decode, id } = byteTokenizer([[0xe5, 0x9b], [0xad]]);
    const r = run(decode, [[id(0xe5, 0x9b)], [PAD], [id(0xad)]]);
    r.pushAll();
    r.acc.end();
    expect(r.results).toEqual(['园']);
  });

  // P7. A byte that can never be part of a character used to stop the
  // accumulator for good: it cut at the FIRST U+FFFD on every push, so the
  // rest of the utterance was never shown, and end() dropped it as well.
  it('keeps printing after a byte that can never become a character', () => {
    const { decode, id } = byteTokenizer([utf8(' ok'), [0x9b], utf8(' more'), utf8(' text.')]);
    const r = run(decode, [[id(...utf8(' ok'))], [id(0x9b)], [id(...utf8(' more'))], [id(...utf8(' text.'))]]);
    r.pushAll();
    expect(r.acc.pending).toBe(' ok� more text.');
    r.acc.end();
    expect(r.results).toEqual(['ok� more text.']);
  });

  it('keeps printing after a byte that can never become a character, without the opt-in too', () => {
    const { decode, id } = byteTokenizer([utf8(' ok'), [0x9b], utf8(' more')]);
    const r = run(decode, [[id(...utf8(' ok'))], [id(0x9b)], [id(...utf8(' more'))]], { positionIndependentDecode: false });
    r.pushAll();
    r.acc.end();
    expect(r.results).toEqual(['ok� more']);
  });

  it('drops a character left unfinished when the run ends, as it always has', () => {
    const { decode, id } = byteTokenizer([utf8('ok'), [0xe5, 0x9b]]);
    const r = run(decode, [[id(...utf8('ok'))], [id(0xe5, 0x9b)]]);
    r.pushAll();
    r.acc.end();
    expect(r.results).toEqual(['ok']);
  });

  it('forgets held bytes when the run is discarded, so the next utterance starts clean', () => {
    const { decode, id } = byteTokenizer([[0xe5, 0x9b], [0xad], utf8('ok')]);
    const r = run(decode, [[id(0xe5, 0x9b)]]);
    r.pushAll();
    r.acc.end({ discard: true });
    r.acc.push([id(0xad)]); // would complete 园 if the held bytes had survived
    r.acc.push([id(...utf8('ok'))]);
    r.acc.end();
    expect(r.results).toEqual(['�ok']);
  });

  // An aperiodic utterance: mixed scripts cut into 1-4 byte tokens at
  // pseudo-random points, so characters straddle tokens everywhere, with
  // specials in between. Periodic input let a "reset every k tokens" mutant
  // pass an earlier version of this test.
  function aperiodicUtterance(tokens: number, seed: number) {
    let state = seed >>> 0;
    const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
    const pick = (chars: string) => Array.from(chars)[Math.floor(rand() * Array.from(chars).length)];
    const bytes: number[] = [];
    while (bytes.length < tokens * 3) {
      const r = rand();
      const ch = r < 0.45 ? pick('abcdefghijklmnopqrstuvwxyz      ')
        : r < 0.6 ? pick('今天天气很好我们出去走走吧园')
        : r < 0.7 ? pick('안녕하세요반갑습니다')
        : r < 0.8 ? pick('привет éàü')
        : r < 0.87 ? pick('😀🎉👍🌏')
        : pick('.,!?。、');
      bytes.push(...utf8(ch));
    }
    const pieces: number[][] = [];
    const pushes: number[][][] = [];
    for (let i = 0; i < bytes.length && pushes.length < tokens; ) {
      const len = Math.min(1 + Math.floor(rand() * 4), bytes.length - i);
      const piece = bytes.slice(i, i + len);
      pieces.push(piece);
      pushes.push([piece]);
      if (rand() < 0.1) pushes.push([]); // a special token, marked by an empty entry
      i += len;
    }
    const { decode, id } = byteTokenizer(pieces);
    const ids = pushes.map((p) => (p.length === 0 ? [PAD] : [id(...p[0])]));
    return { decode, ids };
  }

  it('shows, after every push, exactly the whole utterance decoded so far, minus a character still arriving', () => {
    for (const positionIndependentDecode of [true, false]) {
      const { decode, ids } = aperiodicUtterance(750, 20260920);
      const r = run(decode, ids, { positionIndependentDecode });
      const seen: bigint[] = [];
      for (const push of ids) {
        r.acc.push(push);
        seen.push(...push);
        expect(r.acc.pending).toBe(decode(seen).replace(/�+$/, ''));
      }
    }
  });

  // The fix itself: decoding the whole utterance on every push made a
  // 375-token utterance cost 375²/2 token decodes.
  it('decodes each token a bounded number of times instead of the whole utterance on every push', () => {
    const { decode, ids } = aperiodicUtterance(750, 7);
    const r = run(decode, ids);
    r.pushAll();
    const decoded = r.lengths.reduce((a, b) => a + b, 0);
    expect(decoded).toBeLessThanOrEqual(4 * ids.length);
  });

  it('still decodes the whole utterance on every push without the opt-in', () => {
    const { decode, id } = byteTokenizer([utf8('a'), utf8('b'), utf8('c')]);
    const r = run(decode, [[id(0x61)], [id(0x62)], [id(0x63)]], { positionIndependentDecode: false });
    r.pushAll();
    expect(r.lengths).toEqual([1, 2, 3]);
  });

  // A run of one repeated letter: the real tokenizer encodes 40 × ה as
  // [d7 94 d7] then [94 d7] again and again — every token starts with the
  // continuation byte of one ה and ends with the lead byte of the next — so
  // the window never ends between characters while text keeps flowing. A cap
  // on the window's length turned one letter into "��" here; 11 of all
  // 108,875 multi-byte code points do this, 萡 among Voxtral's languages.
  it('prints a run of one letter that the tokenizer cuts mid-character at every token', () => {
    const { decode, id } = byteTokenizer([[0xd7, 0x94, 0xd7], [0x94, 0xd7], [0x94]]);
    const pushes = [[id(0xd7, 0x94, 0xd7)], ...Array.from({ length: 40 }, () => [id(0x94, 0xd7)]), [id(0x94)]];
    const r = run(decode, pushes);
    r.pushAll();
    expect(r.partials.every((p) => !p.includes('�'))).toBe(true);
    r.acc.end();
    expect(r.results).toEqual(['ה'.repeat(42)]);
  });

  // The longest a real character can keep a push from printing: four bytes in
  // four tokens is three pushes with nothing to show. A stall cap below that
  // would print the emoji as U+FFFD; any cap from three up behaves the same on
  // valid text, and differs only in how soon garbage bytes are printed.
  it('waits out a four-byte character that arrives one byte per token', () => {
    const { decode, id } = byteTokenizer([utf8('ok '), [0xf0], [0x9f], [0x98], [0x80]]);
    const r = run(decode, [[id(...utf8('ok '))], [id(0xf0)], [id(0x9f)], [id(0x98)], [id(0x80)]]);
    r.pushAll();
    r.acc.end();
    expect(r.results).toEqual(['ok 😀']);
  });

  it('completes a held character in the result after one the punctuation endpoint already sealed', () => {
    // "." plus the first two bytes of 园, then its last byte, then " ok".
    const { decode, id } = byteTokenizer([[0x2e, 0xe5, 0x9b], [0xad], utf8(' ok')]);
    const partials: string[] = [];
    const results: string[] = [];
    const acc = new StreamingTextAccumulator(decode, {
      onPartial: (t) => partials.push(t),
      onResult: (t) => results.push(t),
      positionIndependentDecode: true,
    });
    for (const push of [[id(0x2e, 0xe5, 0x9b)], [id(0xad)], [id(...utf8(' ok'))]]) acc.push(push);
    acc.end();
    expect(results).toEqual(['.', '园 ok']);
  });

  it('decodes the whole utterance on every push unless the caller opts in', () => {
    const { decode, id } = byteTokenizer([utf8('a'), utf8('b'), utf8('c')]);
    const lengths: number[] = [];
    const acc = new StreamingTextAccumulator(
      (t) => { lengths.push(t.length); return decode(t); },
      { onPartial: () => {}, onResult: () => {} },
    );
    for (const b of [0x61, 0x62, 0x63]) acc.push([id(b)]);
    expect(lengths).toEqual([1, 2, 3]);
  });

  // Bytes that never form a character keep the window's text ending in
  // U+FFFD, so without a cap the window grows for as long as they last and
  // prints nothing: 300 lone lead bytes held 300 tokens and decoded 45,000.
  it('gives up on a tail that has stayed unfinished for longer than any character can', () => {
    const { decode, id } = byteTokenizer([[0xe5]]);
    const r = run(decode, Array.from({ length: 100 }, () => [id(0xe5)]));
    r.pushAll();
    expect(Math.max(...r.lengths)).toBeLessThanOrEqual(33);
    expect(r.partials.length).toBeGreaterThan(0);
    expect(r.acc.pending).toMatch(/^�+$/);
  });

  it('is what the Voxtral worker opts into', () => {
    const src = readFileSync(fileURLToPath(new URL('../voxtral-webgpu.worker.ts', here)), 'utf8');
    const construction = src.slice(src.indexOf('new StreamingTextAccumulator('));
    expect(construction.slice(0, construction.indexOf('\n    );'))).toMatch(/positionIndependentDecode:\s*true/);
  });
});
