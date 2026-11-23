import { describe, it, expect } from 'vitest';
import { FrameLog } from './frame-log';
import { SegmentAssembler } from './segment-assembler';
import type { DetectorNotice, DetectorOutput, TurnTrace } from './turn-detector-protocol';

/** `n` samples whose values are their positions on the timeline. */
const ramp = (from: number, n: number) => Float32Array.from({ length: n }, (_, i) => from + i);

describe('FrameLog', () => {
  it('slice is a fresh copy of exactly [from, to), across the chunks appended', () => {
    const log = new FrameLog();
    log.append(ramp(0, 512));
    log.append(ramp(512, 512));
    log.append(ramp(1024, 300));
    expect(log.end).toBe(1324);
    const out = log.slice(500, 1100);
    expect(out).toEqual(ramp(500, 600));
    out[0] = -1;
    expect(log.slice(500, 501)).toEqual(ramp(500, 1));
    expect(log.slice(700, 700)).toEqual(new Float32Array(0));
  });

  it('trimBefore forgets what lies before the position: slicing it throws, the rest still slices', () => {
    const log = new FrameLog();
    for (let at = 0; at < 4096; at += 512) log.append(ramp(at, 512));
    log.trimBefore(1100);
    expect(() => log.slice(1099, 1200)).toThrow(RangeError);
    expect(log.slice(1100, 4096)).toEqual(ramp(1100, 2996));
    log.trimBefore(600);
    expect(() => log.slice(1099, 1200)).toThrow(RangeError);
  });

  it('end counts every sample appended, trimmed or not; slicing past it throws', () => {
    const log = new FrameLog();
    log.append(ramp(0, 512));
    log.trimBefore(512);
    log.append(ramp(512, 100));
    expect(log.end).toBe(612);
    expect(() => log.slice(600, 613)).toThrow(RangeError);
    expect(log.slice(512, 612)).toEqual(ramp(512, 100));
  });
});

describe('SegmentAssembler', () => {
  function assembler(earliestNeeded: () => number = () => 0) {
    const posted: Array<{ msg: DetectorOutput; transfer: Transferable[] }> = [];
    const notices: DetectorNotice[] = [];
    const a = new SegmentAssembler({ post: (msg, transfer) => posted.push({ msg, transfer }), notify: (n) => notices.push(n), earliestNeeded });
    const frames = (from: number, count: number) => {
      for (let i = 0; i < count; i++) a.trace({ kind: 'frame', from: from + i * 512, to: from + (i + 1) * 512, samples: ramp(from + i * 512, 512), raw: new Int16Array(0) });
    };
    return { a, posted, notices, frames };
  }

  it("slices each close into a segment: its interval, endedBy, press and Smart probability as traced, the buffer transferred", () => {
    const { a, posted, frames } = assembler();
    frames(0, 6);
    a.trace({ kind: 'open', at: 512 });
    a.trace({ kind: 'close', from: 512, to: 2048, endedBy: 'smart', smartTurnProbability: 0.8 });
    a.trace({ kind: 'open', at: 2048, press: 3 });
    a.trace({ kind: 'close', from: 2048, to: 2560, endedBy: 'cap', press: 3 });
    a.trace({ kind: 'frame', from: 3072, to: 3200, samples: ramp(3072, 128), raw: new Int16Array(0) });

    expect(posted.map((p) => p.msg)).toEqual([
      { type: 'segment', epoch: 1, seq: 1, audio: ramp(512, 1536), start: 512, end: 2048, endedBy: 'smart', smartTurnProbability: 0.8 },
      { type: 'segment', epoch: 1, seq: 2, press: 3, audio: ramp(2048, 512), start: 2048, end: 2560, endedBy: 'cap' },
    ]);
    for (const { msg, transfer } of posted) {
      if (msg.type !== 'segment') throw new Error('only segments here');
      expect(transfer).toHaveLength(1);
      expect(transfer[0]).toBe(msg.audio.buffer);
    }
    expect('smartTurnProbability' in posted[1].msg).toBe(false);
    expect('press' in posted[0].msg).toBe(false);
  });

  it('a drop posts nothing; cancel and drained pass through in trace order, every output numbered from 1 with its epoch', () => {
    const { a, posted } = assembler();
    const order: TurnTrace[] = [];
    const trace = (e: TurnTrace) => {
      order.push(e);
      a.trace(e);
    };
    trace({ kind: 'frame', from: 0, to: 512, samples: ramp(0, 512), raw: new Int16Array(0) });
    trace({ kind: 'open', at: 0 });
    trace({ kind: 'drop', from: 0, to: 512 });
    trace({ kind: 'cancel', press: 2 });
    trace({ kind: 'frame', from: 512, to: 1024, samples: ramp(512, 512), raw: new Int16Array(0) });
    trace({ kind: 'open', at: 512 });
    trace({ kind: 'close', from: 512, to: 1024, endedBy: 'flush' });
    trace({ kind: 'drained' });

    expect(posted.map((p) => p.msg.type)).toEqual(['cancel', 'segment', 'drained']);
    expect(posted.map((p) => [p.msg.seq, p.msg.epoch])).toEqual([[1, 1], [2, 1], [3, 1]]);
    expect(posted[0]).toEqual({ msg: { type: 'cancel', epoch: 1, seq: 1, press: 2 }, transfer: [] });
    expect(posted[2]).toEqual({ msg: { type: 'drained', epoch: 1, seq: 3 }, transfer: [] });
  });

  it('starts at the epoch it is given', () => {
    const posted: DetectorOutput[] = [];
    const a = new SegmentAssembler({ post: (msg) => posted.push(msg), notify: () => {}, earliestNeeded: () => 0, epoch: 4 });
    a.trace({ kind: 'drained' });
    expect(posted).toEqual([{ type: 'drained', epoch: 4, seq: 1 }]);
  });

  it('keeps only what the core still needs: a close from before earliestNeeded() cannot be sliced', () => {
    let needed = 0;
    const { a, posted, frames } = assembler(() => needed);
    frames(0, 4);
    needed = 1024;
    frames(2048, 1);
    a.trace({ kind: 'close', from: 1024, to: 2560, endedBy: 'silence' });
    expect(posted[0].msg).toMatchObject({ start: 1024, end: 2560 });
    expect(() => a.trace({ kind: 'close', from: 512, to: 2560, endedBy: 'silence' })).toThrow(RangeError);
  });

  /** `count` segments of `samples` each, the n-th traced as seq n. */
  const segments = (a: SegmentAssembler, count: number, samples: number, from = 0) => {
    for (let i = 0; i < count; i++) {
      const at = from + i * samples;
      a.trace({ kind: 'frame', from: at, to: at + samples, samples: ramp(at, samples), raw: new Int16Array(0) });
      a.trace({ kind: 'close', from: at, to: at + samples, endedBy: 'silence' });
    }
  };

  it('a sixth waiting segment fails the leg once; taken acks free the queue; nothing is posted after', () => {
    const { a, posted, notices } = assembler();
    segments(a, 5, 100);
    expect(notices).toEqual([]);
    a.taken({ type: 'taken', epoch: 1, seq: 1 });
    segments(a, 1, 100, 500);
    expect(notices).toEqual([]); // five waiting again
    segments(a, 1, 100, 600);
    expect(notices).toEqual([
      { type: 'failed', code: 'turn_detection_overloaded', message: 'Turn detection cannot keep up on this device.' },
    ]);
    const count = posted.length;
    expect(count).toBe(7); // the segment that tipped it was posted
    segments(a, 2, 100, 700);
    expect(posted).toHaveLength(count);
    expect(notices).toHaveLength(1);
  });

  it('more than 30 s waiting ahead of the newest segment fails it; one 40 s segment alone does not', () => {
    const s = 16000;
    const lone = assembler();
    segments(lone.a, 1, 40 * s);
    expect(lone.notices).toEqual([]);

    const exact = assembler();
    segments(exact.a, 1, 30 * s);
    segments(exact.a, 1, 40 * s, 30 * s); // exactly 30 s ahead of the newest
    expect(exact.notices).toEqual([]);

    const over = assembler();
    segments(over.a, 1, 30 * s + 1);
    segments(over.a, 1, 5 * s, 30 * s + 1);
    expect(over.notices).toHaveLength(1);
    expect(over.notices[0]).toMatchObject({ code: 'turn_detection_overloaded' });
  });

  it('stop(2) numbers what follows with the new epoch and forgets what waited; a taken of epoch 1 is ignored', () => {
    const { a, posted, notices } = assembler();
    segments(a, 5, 100);
    a.stop(2);
    a.taken({ type: 'taken', epoch: 1, seq: 1 });
    segments(a, 5, 100, 500);
    expect(notices).toEqual([]); // five of epoch 2, the epoch-1 queue forgotten
    expect(posted.map((p) => p.msg.epoch)).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
    expect(posted.map((p) => p.msg.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    segments(a, 1, 100, 1000);
    expect(notices).toHaveLength(1); // the stale ack freed nothing: a sixth of epoch 2 fails
  });

  it('the decode bound counts audio the post has already detached, as a real postMessage does', () => {
    const detaching = () => {
      const notices: DetectorNotice[] = [];
      const a = new SegmentAssembler({
        post: (msg, transfer) => {
          structuredClone(msg, { transfer });
        },
        notify: (n) => notices.push(n),
        earliestNeeded: () => 0,
      });
      return { a, notices };
    };
    const s = 16000;
    const lone = detaching();
    segments(lone.a, 1, 40 * s);
    expect(lone.notices).toEqual([]);

    const over = detaching();
    segments(over.a, 1, 30 * s + 1);
    segments(over.a, 1, 5 * s, 30 * s + 1);
    expect(over.notices).toHaveLength(1);
    expect(over.notices[0]).toMatchObject({ code: 'turn_detection_overloaded' });
  });
});
