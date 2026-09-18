import { describe, it, expect } from 'vitest';
import {
  boundedBatchEndSample,
  promoteQueued,
  QueuedUtterance,
  StreamingAudioFeed,
  StreamingTextAccumulator,
  tailPadSamples,
} from './streaming-generation';

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

describe('StreamingTextAccumulator', () => {
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
