import { afterEach, describe, expect, it } from 'vitest';
import { SegmentInbox, type DecodeTag } from './segment-inbox';
import type { DetectorOutput, RecognizerTaken } from './turn-detector-protocol';

const tick = () => new Promise<void>((r) => setTimeout(r, 15));

function seg(seq: number, extra: Partial<Extract<DetectorOutput, { type: 'segment' }>> = {}): DetectorOutput {
  return { type: 'segment', epoch: 1, seq, audio: new Float32Array([seq]), start: seq * 100, end: seq * 100 + 1, endedBy: 'silence', ...extra };
}

interface Call { seq: number; tag: DecodeTag; start: number; audio: Float32Array; release: () => void }

function setup(opts: { auto?: boolean; throwOn?: number } = {}) {
  const { port1: detector, port2: recognizer } = new MessageChannel();
  const taken: RecognizerTaken[] = [];
  detector.onmessage = (e) => taken.push(e.data);
  const calls: Call[] = [];
  const drained: { type: 'drained'; epoch: number; seq: number }[] = [];
  const finished: number[] = [];
  const inbox = new SegmentInbox(
    recognizer,
    (audio, start, tag) =>
      new Promise<void>((resolve, reject) => {
        const call: Call = {
          seq: tag.seq, tag, start, audio,
          release: () => { finished.push(tag.seq); opts.throwOn === tag.seq ? reject(new Error('boom')) : resolve(); },
        };
        calls.push(call);
        if (opts.auto) call.release();
      }),
    (m) => drained.push(m),
  );
  const closeAll = () => { detector.close(); recognizer.close(); };
  return { detector, inbox, taken, calls, drained, finished, closeAll };
}

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; });
function s(opts?: Parameters<typeof setup>[0]) { const x = setup(opts); cleanup = x.closeAll; return x; }

describe('SegmentInbox', () => {
  it('decodes one segment at a time, in seq order, and acks taken as each starts', async () => {
    const t = s();
    t.detector.postMessage(seg(1)); t.detector.postMessage(seg(2));
    await tick();
    expect(t.calls.map((c) => c.seq)).toEqual([1]);
    expect(t.taken).toEqual([{ type: 'taken', epoch: 1, seq: 1 }]);
    t.calls[0].release(); await tick();
    expect(t.calls.map((c) => c.seq)).toEqual([1, 2]);
    expect(t.taken.map((x) => x.seq)).toEqual([1, 2]);
    t.calls[1].release(); await tick();
  });

  it('seq need not start at 1 (monotonic across epochs)', async () => {
    const t = s({ auto: true });
    t.detector.postMessage(seg(7, { epoch: 2 })); await tick();
    expect(t.calls.map((c) => c.seq)).toEqual([7]);
  });

  it('a slow decode does not stop segments arriving; they wait in order', async () => {
    const t = s();
    for (const n of [1, 2, 3]) t.detector.postMessage(seg(n));
    await tick();
    expect(t.calls).toHaveLength(1);
    t.calls[0].release(); await tick(); t.calls[1].release(); await tick(); t.calls[2].release(); await tick();
    expect(t.finished).toEqual([1, 2, 3]);
  });

  it('after stop(2), segments of epoch 1 are dropped and acked taken', async () => {
    const t = s();
    t.detector.postMessage(seg(1)); t.detector.postMessage(seg(2)); await tick();
    t.inbox.stop(2); await tick();
    t.detector.postMessage(seg(3)); // epoch 1 arriving late
    t.detector.postMessage(seg(4, { epoch: 2 })); await tick();
    t.calls[0].release(); await tick();
    expect(t.calls.map((c) => c.seq)).toEqual([1, 4]);
    expect(t.taken.map((x) => x.seq).sort()).toEqual([1, 2, 3, 4]);
    t.calls[1].release(); await tick();
  });

  it("cancel{press} drops that press's segments not yet started; the one decoding finishes", async () => {
    const t = s();
    t.detector.postMessage(seg(1, { press: 5, endedBy: 'cap' }));
    t.detector.postMessage(seg(2, { press: 5 }));
    t.detector.postMessage(seg(3, { press: 6 }));
    t.detector.postMessage({ type: 'cancel', epoch: 1, seq: 4, press: 5 });
    await tick();
    expect(t.taken.map((x) => x.seq).sort()).toEqual([1, 2]); // 2 dropped and acked
    t.calls[0].release(); await tick();
    expect(t.calls.map((c) => c.seq)).toEqual([1, 3]);
    expect(t.finished).toEqual([1]);
    t.calls[1].release(); await tick();
  });

  it('a released press (no cancel) keeps its results', async () => {
    const t = s({ auto: true });
    t.detector.postMessage(seg(1, { press: 5, endedBy: 'release' })); await tick();
    expect(t.calls[0].tag.press).toBe(5);
  });

  it('drained{seq} is answered once everything before it is decoded or dropped', async () => {
    const t = s();
    t.detector.postMessage(seg(1)); t.detector.postMessage(seg(2));
    t.detector.postMessage({ type: 'drained', epoch: 1, seq: 3 });
    await tick();
    expect(t.drained).toEqual([]);
    t.calls[0].release(); await tick();
    expect(t.drained).toEqual([]);
    t.calls[1].release(); await tick();
    expect(t.drained).toEqual([{ type: 'drained', epoch: 1, seq: 3 }]);
  });

  it('drained with nothing pending is answered at once', async () => {
    const t = s();
    t.detector.postMessage({ type: 'drained', epoch: 1, seq: 1 }); await tick();
    expect(t.drained).toHaveLength(1);
  });

  it('drained of an older epoch stays unanswered after stop(epoch)', async () => {
    const t = s();
    t.detector.postMessage(seg(1));
    t.detector.postMessage({ type: 'drained', epoch: 1, seq: 2 }); await tick();
    t.inbox.stop(2); // stop while decoding
    t.calls[0].release(); await tick();
    expect(t.drained).toEqual([]);
    t.detector.postMessage({ type: 'drained', epoch: 1, seq: 3 }); await tick();
    expect(t.drained).toEqual([]);
    t.detector.postMessage({ type: 'drained', epoch: 2, seq: 4 }); await tick();
    expect(t.drained).toEqual([{ type: 'drained', epoch: 2, seq: 4 }]);
  });

  it('a decode that throws does not stop the next', async () => {
    const t = s({ throwOn: 1 });
    t.detector.postMessage(seg(1)); t.detector.postMessage(seg(2)); await tick();
    t.calls[0].release(); await tick();
    expect(t.calls.map((c) => c.seq)).toEqual([1, 2]);
    t.calls[1].release(); await tick();
  });

  it('passes start, press, epoch, endedBy and the Smart probability to decode', async () => {
    const t = s();
    t.detector.postMessage(seg(1, { press: 3, start: 1234, endedBy: 'smart', smartTurnProbability: 0.8, epoch: 4 })); await tick();
    const c = t.calls[0];
    expect(c.start).toBe(1234);
    expect(c.tag).toMatchObject({ press: 3, epoch: 4, endedBy: 'smart', smartTurnProbability: 0.8, seq: 1 });
    expect(Array.from(c.audio)).toEqual([1]);
    c.release(); await tick();
  });

  it('close() stops listening and resolves after the decode in flight', async () => {
    const t = s();
    t.detector.postMessage(seg(1)); t.detector.postMessage(seg(2)); await tick();
    let closed = false;
    const p = t.inbox.close().then(() => { closed = true; });
    await tick();
    expect(closed).toBe(false);
    t.calls[0].release(); await p;
    expect(closed).toBe(true);
    expect(t.calls).toHaveLength(1);
  });
});
