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
      for (let i = 0; i < count; i++) a.trace({ kind: 'frame', from: from + i * 512, to: from + (i + 1) * 512, samples: ramp(from + i * 512, 512) });
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
    a.trace({ kind: 'frame', from: 3072, to: 3200, samples: ramp(3072, 128) });

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
    trace({ kind: 'frame', from: 0, to: 512, samples: ramp(0, 512) });
    trace({ kind: 'open', at: 0 });
    trace({ kind: 'drop', from: 0, to: 512 });
    trace({ kind: 'cancel', press: 2 });
    trace({ kind: 'frame', from: 512, to: 1024, samples: ramp(512, 512) });
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
});
