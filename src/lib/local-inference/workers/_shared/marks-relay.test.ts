import { describe, expect, it, vi } from 'vitest';
import type { VadWebConfig } from '../../types';
import { MarksRelay, type RelayOutput } from './marks-relay';
import { TurnDetectorCore } from './turn-detector-core';
import type { TurnTrace } from './turn-detector-protocol';

const FRAME = 512;
/** One 16 kHz frame at 24 kHz. */
const IN_FRAME = 768;

/** Pad 2 frames, redemption 4, minSpeech 3; speech from 0.5, silence under 0.35. */
const VAD: VadWebConfig = {
  threshold: 0.5,
  negativeThreshold: 0.35,
  preSpeechPadDuration: 0.064,
  minSilenceDuration: 0.128,
  minSpeechDuration: 0.096,
  maxSpeechDuration: 30,
};

/** The relay's output as tokens: `[a,b)` for audio whose samples are the input indices a to b, else the mark. */
function tokens(out: RelayOutput[]): string[] {
  return out.map((o) => {
    if (o.type === 'mark') return o.event;
    const a = o.pcm[0];
    const b = o.pcm[o.pcm.length - 1] + 1;
    expect(b - a).toBe(o.pcm.length); // consecutive input samples
    return `[${a},${b})`;
  });
}

/** Hand-written traces over an input whose sample i is the number i. */
function rig() {
  const out: RelayOutput[] = [];
  const relay = new MarksRelay((o) => out.push(o));
  let next = 0;
  return {
    out,
    /** What has been relayed, once the frame still held is out too. */
    tokens: () => {
      relay.trace({ kind: 'drained' });
      return tokens(out);
    },
    trace: (e: TurnTrace) => relay.trace(e),
    /** A frame of the 16 kHz span [from, to): its raw is the next round((to - from) · 1.5) input samples, or `len`. */
    frame(from: number, to: number, len = Math.round((to - from) * 1.5)) {
      const raw = new Int16Array(len).map((_, i) => next + i);
      next += len;
      relay.trace({ kind: 'frame', from, to, samples: new Float32Array(to - from), raw });
    },
    frames(from: number, count: number) {
      for (let i = 0; i < count; i++) this.frame(from + i * FRAME, from + (i + 1) * FRAME);
    },
  };
}

describe('MarksRelay on hand-written traces', () => {
  it('relays a frame at once, without waiting for later audio', async () => {
    const r = rig();
    r.frame(0, FRAME);
    expect(tokens(r.out)).toEqual([]);
    await Promise.resolve();
    expect(tokens(r.out)).toEqual(['[0,768)']);
  });

  it('an end or cancel mark sits between the frames it separates: no sample past the boundary precedes it', () => {
    const r = rig();
    r.trace({ kind: 'open', at: 0 });
    r.frames(0, 3);
    r.trace({ kind: 'close', from: 0, to: 3 * FRAME, endedBy: 'silence' });
    r.frames(3 * FRAME, 2);
    r.trace({ kind: 'open', at: 3 * FRAME });
    r.trace({ kind: 'drop', from: 3 * FRAME, to: 5 * FRAME });
    r.frames(5 * FRAME, 1);
    expect(r.tokens()).toEqual(['start', '[0,768)', '[768,1536)', '[1536,2304)', 'end', '[2304,3072)', 'start', '[3072,3840)', 'cancel', '[3840,4608)']);
  });

  it('the start mark is placed right before the detecting frame, not at the pre-padded open.at; the pre-pad audio precedes it', () => {
    const r = rig();
    r.frames(0, 5); // frame 4 is the detecting frame
    r.trace({ kind: 'open', at: 2 * FRAME }); // pre-pad: two frames before it
    r.frames(5 * FRAME, 1);
    expect(r.tokens()).toEqual(['[0,768)', '[768,1536)', '[1536,2304)', '[2304,3072)', 'start', '[3072,3840)', '[3840,4608)']);
  });

  it('a boundary inside a chunk: audio before the mark and the mark before the rest of the chunk', () => {
    const r = rig();
    r.trace({ kind: 'open', at: 0, press: 1 });
    r.frame(0, FRAME);
    r.trace({ kind: 'close', from: 0, to: 301, endedBy: 'cap', press: 1 }); // round(301 · 1.5) = 452
    r.trace({ kind: 'open', at: 301, press: 1 });
    expect(tokens(r.out)).toEqual(['start', '[0,452)', 'end', 'start']);
    r.frames(FRAME, 1);
    r.trace({ kind: 'close', from: 301, to: 2 * FRAME, endedBy: 'release', press: 1 });
    expect(r.tokens()).toEqual(['start', '[0,452)', 'end', 'start', '[452,768)', '[768,1536)', 'end']);
  });

  it("on release the partial frame's real samples are relayed before the closing mark, mid-stream too", () => {
    const r = rig();
    r.trace({ kind: 'open', at: 0, press: 1 });
    r.frames(0, 2);
    r.frame(2 * FRAME, 2 * FRAME + 300); // 450 real samples
    r.trace({ kind: 'close', from: 0, to: 2 * FRAME + 300, endedBy: 'release', press: 1 });
    r.trace({ kind: 'open', at: 2 * FRAME + 300, press: 2 });
    r.frames(2 * FRAME + 300, 1);
    expect(r.tokens()).toEqual(['start', '[0,768)', '[768,1536)', '[1536,1986)', 'end', 'start', '[1986,2754)']);
  });

  it('a cap continuation in an automatic turn: end then start at the cut, the cut at the frame end', () => {
    const r = rig();
    r.frames(0, 3);
    r.trace({ kind: 'open', at: 0 });
    r.frames(3 * FRAME, 1);
    r.trace({ kind: 'close', from: 0, to: 4 * FRAME, endedBy: 'cap' });
    r.trace({ kind: 'open', at: 4 * FRAME });
    r.frames(4 * FRAME, 1);
    expect(r.tokens()).toEqual(['[0,768)', '[768,1536)', 'start', '[1536,2304)', '[2304,3072)', 'end', 'start', '[3072,3840)']);
  });

  it('a cap continuation in a press: the cut inside the frame that crossed it, end and start exactly between the samples', () => {
    const r = rig();
    r.trace({ kind: 'open', at: 0, press: 4 });
    r.frame(0, FRAME);
    r.trace({ kind: 'close', from: 0, to: 256, endedBy: 'cap', press: 4 });
    r.trace({ kind: 'open', at: 256, press: 4 });
    r.frame(FRAME, 2 * FRAME);
    r.trace({ kind: 'close', from: 256, to: 2 * FRAME, endedBy: 'release', press: 4 });
    expect(r.tokens()).toEqual(['start', '[0,384)', 'end', 'start', '[384,768)', '[768,1536)', 'end']);
  });

  it('a press: begin settles first, the old press ends before the new one starts', () => {
    const r = rig();
    r.trace({ kind: 'open', at: 0, press: 1 });
    r.frames(0, 1);
    r.trace({ kind: 'close', from: 0, to: FRAME, endedBy: 'release', press: 1 });
    r.trace({ kind: 'open', at: FRAME, press: 2 });
    r.frames(FRAME, 1);
    r.trace({ kind: 'close', from: FRAME, to: 2 * FRAME, endedBy: 'release', press: 2 });
    r.trace({ kind: 'drained' });
    expect(r.tokens()).toEqual(['start', '[0,768)', 'end', 'start', '[768,1536)', 'end']);
  });

  it('a stray cancel (a press already released, a later press open) makes no mark and disturbs nothing', () => {
    const r = rig();
    r.trace({ kind: 'open', at: 0, press: 1 });
    r.frames(0, 1);
    r.trace({ kind: 'close', from: 0, to: FRAME, endedBy: 'release', press: 1 });
    r.trace({ kind: 'open', at: FRAME, press: 2 });
    r.frames(FRAME, 1);
    r.trace({ kind: 'cancel', press: 1 });
    r.frames(2 * FRAME, 1);
    r.trace({ kind: 'close', from: FRAME, to: 3 * FRAME, endedBy: 'release', press: 2 });
    expect(r.tokens()).toEqual(['start', '[0,768)', 'end', 'start', '[768,1536)', '[1536,2304)', 'end']);
  });

  it('a cancel of the press released last, with nothing opened since, is a cancel mark after its end mark (the consumer may still be finishing it)', () => {
    const r = rig();
    r.trace({ kind: 'open', at: 0, press: 1 });
    r.frames(0, 1);
    r.trace({ kind: 'close', from: 0, to: FRAME, endedBy: 'release', press: 1 });
    r.trace({ kind: 'cancel', press: 1 });
    r.trace({ kind: 'cancel', press: 1 });
    expect(r.tokens()).toEqual(['start', '[0,768)', 'end', 'cancel']);
  });

  it('a cancel naming an older released press makes no mark', () => {
    const r = rig();
    r.trace({ kind: 'open', at: 0, press: 1 });
    r.frames(0, 1);
    r.trace({ kind: 'close', from: 0, to: FRAME, endedBy: 'release', press: 1 });
    r.trace({ kind: 'open', at: FRAME, press: 2 });
    r.frames(FRAME, 1);
    r.trace({ kind: 'close', from: FRAME, to: 2 * FRAME, endedBy: 'release', press: 2 });
    r.trace({ kind: 'cancel', press: 1 });
    expect(r.tokens()).toEqual(['start', '[0,768)', 'end', 'start', '[768,1536)', 'end']);
  });

  it('a cancel naming the open press is a cancel mark, after the audio so far; the press then ends no more', () => {
    const r = rig();
    r.trace({ kind: 'open', at: 0, press: 3 });
    r.frames(0, 2);
    r.trace({ kind: 'cancel', press: 3 });
    r.trace({ kind: 'cancel', press: 3 });
    r.frames(2 * FRAME, 1);
    expect(r.tokens()).toEqual(['start', '[0,768)', '[768,1536)', 'cancel', '[1536,2304)']);
  });

  it('an empty press (open, drop) is start then cancel', () => {
    const r = rig();
    r.frames(0, 1);
    r.trace({ kind: 'open', at: FRAME, press: 1 });
    r.trace({ kind: 'drop', from: FRAME, to: FRAME });
    r.trace({ kind: 'drained' });
    expect(r.tokens()).toEqual(['[0,768)', 'start', 'cancel']);
  });

  it('a consumer reading the output a second late changes nothing: order alone places the marks', () => {
    vi.useFakeTimers();
    try {
      const run = (gap: number) => {
        const r = rig();
        r.trace({ kind: 'open', at: 0, press: 1 });
        r.frames(0, 2);
        vi.advanceTimersByTime(gap);
        r.trace({ kind: 'close', from: 0, to: FRAME + 100, endedBy: 'cap', press: 1 });
        vi.advanceTimersByTime(gap);
        r.trace({ kind: 'open', at: FRAME + 100, press: 1 });
        r.frames(2 * FRAME, 1);
        vi.advanceTimersByTime(gap);
        r.trace({ kind: 'close', from: FRAME + 100, to: 3 * FRAME, endedBy: 'release', press: 1 });
        return r.tokens();
      };
      expect(run(1000)).toEqual(run(0));
    } finally {
      vi.useRealTimers();
    }
  });
});

/** The relay over a real core, and the input it was given. */
function wired(turns: 'auto' | 'manual', probs: number[] = []) {
  const out: RelayOutput[] = [];
  const trace: TurnTrace[] = [];
  const relay = new MarksRelay((o) => out.push(o));
  let asked = 0;
  const core = new TurnDetectorCore({
    turns,
    vad: VAD,
    limit: {},
    infer: async () => probs[asked++] ?? 0.1,
    trace: (e) => {
      trace.push(e);
      relay.trace(e);
    },
    notify: () => {},
  });
  const input: number[] = [];
  let seed = 1;
  return {
    core,
    out,
    trace,
    input,
    async push(n: number) {
      const pcm = new Int16Array(n).map(() => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return (seed % 60000) - 30000;
      });
      input.push(...pcm);
      core.push(pcm);
      await core.idle();
    },
    async done() {
      core.drain();
      await core.idle();
      await Promise.resolve();
    },
    audio(): number[] {
      return out.flatMap((o) => (o.type === 'audio' ? [...o.pcm] : []));
    },
  };
}

describe('MarksRelay over the core', () => {
  it('relays every input sample once, in order, in 768-sample spans on the 512-frame grid', async () => {
    const w = wired('auto', [...Array(6).fill(0.9), ...Array(20).fill(0.1)]);
    for (let i = 0; i < 30; i++) await w.push(IN_FRAME);
    await w.done();
    expect(w.audio()).toEqual(w.input);
    const spans = w.out.filter((o) => o.type === 'audio').map((o) => (o as { pcm: Int16Array }).pcm.length);
    expect(spans.every((n) => n === IN_FRAME)).toBe(true);
    expect(spans).toHaveLength(30);
  });

  it('irregular chunk sizes never drift the 24 kHz spans from the 16 kHz frames', async () => {
    const w = wired('manual');
    w.core.begin(1);
    const sizes = [1, 7, 333, 769, 2000, 5, 1535, 4000, 13, 767, 3001];
    for (const n of sizes) await w.push(n);
    await w.done();
    expect(w.audio()).toEqual(w.input);
    const frames = w.trace.filter((e): e is Extract<TurnTrace, { kind: 'frame' }> => e.kind === 'frame');
    for (const f of frames.slice(0, -1)) expect(f.raw.length).toBe(Math.round(((f.to - f.from) * 24000) / 16000));
    // The whole frames are on the grid: frame k's raw ends at input sample 768 · (k + 1).
    let at = 0;
    for (const f of frames) {
      at += f.raw.length;
      if (f.to - f.from === FRAME) expect(at % IN_FRAME).toBe(0);
    }
  });

  it('the start mark is at the detecting frame; the pre-pad audio, the consumer\'s own pre-roll, precedes it', async () => {
    const w = wired('auto', [...Array(4).fill(0.1), ...Array(8).fill(0.9), ...Array(10).fill(0.1)]);
    for (let i = 0; i < 22; i++) await w.push(IN_FRAME);
    await w.done();
    const open = w.trace.find((e) => e.kind === 'open') as Extract<TurnTrace, { kind: 'open' }>;
    const detecting = [...w.trace.slice(0, w.trace.indexOf(open))].reverse().find((e) => e.kind === 'frame') as Extract<TurnTrace, { kind: 'frame' }>;
    expect(open.at).toBeLessThan(detecting.from); // pre-padded
    const before: number[] = [];
    for (const o of w.out) {
      if (o.type === 'mark' && o.event === 'start') break;
      if (o.type === 'audio') before.push(...o.pcm);
    }
    expect(before).toEqual(w.input.slice(0, detecting.from * 1.5));
    expect(before.length).toBeGreaterThan(open.at * 1.5); // the pad span is already out
    expect(w.out.filter((o) => o.type === 'mark').map((o) => (o as { event: string }).event)).toEqual(['start', 'end']);
  });

  it("a cancelled press's tail is relayed before the next press's start; everything after that start is the next press's", async () => {
    const w = wired('manual');
    w.core.begin(1);
    await w.push(FRAME * 3 * 1.5 + 300); // three frames and a tail
    w.core.cancel(1);
    w.core.begin(2);
    const mark = w.input.length;
    await w.push(IN_FRAME * 2);
    await w.done();
    expect(w.audio()).toEqual(w.input);
    expect(w.out.flatMap((o) => (o.type === 'mark' ? [o.event] : []))).toEqual(['start', 'cancel', 'start', 'end']);
    const secondStart = w.out.findIndex((o, i) => o.type === 'mark' && o.event === 'start' && i > 0);
    const before = w.out.slice(0, secondStart).flatMap((o) => (o.type === 'audio' ? [...o.pcm] : []));
    const after = w.out.slice(secondStart).flatMap((o) => (o.type === 'audio' ? [...o.pcm] : []));
    expect(before).toEqual(w.input.slice(0, mark));
    expect(after).toEqual(w.input.slice(mark));
    expect(w.out.findIndex((o) => o.type === 'mark' && o.event === 'cancel')).toBeLessThan(secondStart);
  });

  it("manual: the partial frame's real samples come before the closing mark, then the next press", async () => {
    const w = wired('manual');
    w.core.begin(1);
    await w.push(1200); // one frame and 432 input samples
    w.core.begin(2);
    await w.push(800);
    await w.done();
    expect(w.audio()).toEqual(w.input);
    expect(w.out.flatMap((o) => (o.type === 'mark' ? [o.event] : []))).toEqual(['start', 'end', 'start', 'end']);
    const firstEnd = w.out.findIndex((o) => o.type === 'mark' && o.event === 'end');
    const before = w.out.slice(0, firstEnd).flatMap((o) => (o.type === 'audio' ? [...o.pcm] : []));
    expect(before).toHaveLength(1200);
  });
});

describe('MarksRelay.stop', () => {
  const frame = (from: number, to: number): TurnTrace => ({ kind: 'frame', from, to, samples: new Float32Array(to - from), raw: new Int16Array((to - from) * 1.5).fill(1) });

  it('drops the frame it holds, and the flush queued in a microtask posts nothing', async () => {
    const out: RelayOutput[] = [];
    const relay = new MarksRelay((o) => out.push(o));
    relay.trace(frame(0, FRAME));
    relay.stop();
    await Promise.resolve();
    expect(out).toEqual([]);
  });

  it('ignores every trace after it', async () => {
    const out: RelayOutput[] = [];
    const relay = new MarksRelay((o) => out.push(o));
    relay.stop();
    relay.trace(frame(0, FRAME));
    relay.trace({ kind: 'open', at: 0 });
    relay.trace({ kind: 'close', from: 0, to: FRAME, endedBy: 'silence' });
    relay.trace({ kind: 'drained' });
    await Promise.resolve();
    expect(out).toEqual([]);
  });
});
