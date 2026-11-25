import { afterEach, describe, it, expect } from 'vitest';
import { FrameProcessor } from '@ricky0123/vad-web/dist/frame-processor';
import { Message } from '@ricky0123/vad-web/dist/messages';
import type { VadWebConfig } from '../../types';
import { resolveMaxSpeechFrames, type SegmentLimit } from './max-speech-frames';
import { SegmentAssembler } from './segment-assembler';
import { TimelineResampler } from './timeline-resampler';
import { TurnDetectorCore, type SmartLink, type TurnDetectorCoreOptions } from './turn-detector-core';
import type { DetectorNotice, DetectorOutput, DetectorSegment, TurnTrace } from './turn-detector-protocol';
import { openTurnLink } from './turn-gate';
import type { TurnPredictAnswer, TurnPredictRequest } from './turn-protocol';

const FRAME = 512;
/** One 16 kHz frame at 24 kHz. */
const IN_FRAME = 768;
const SPEECH = 0.9;
const GRAY = 0.4;
const SILENCE = 0.1;

/** Pad 2 frames, redemption 4, minSpeech 3; speech from 0.5, silence under 0.35. */
const VAD: VadWebConfig = {
  threshold: 0.5,
  negativeThreshold: 0.35,
  preSpeechPadDuration: 0.064,
  minSilenceDuration: 0.128,
  minSpeechDuration: 0.096,
  maxSpeechDuration: 30,
};

const run = (n: number, p: number) => Array<number>(n).fill(p);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distinct samples, so a segment's audio shows exactly where it starts and ends. */
function noise(rand: () => number, samples: number): Int16Array {
  const out = new Int16Array(samples);
  for (let i = 0; i < samples; i++) out[i] = Math.floor(rand() * 60000) - 30000;
  return out;
}

/** Runs of speech, gray and silence, each probability a little different. */
function track(rand: () => number, frames: number): number[] {
  const out: number[] = [];
  while (out.length < frames) {
    const r = rand();
    const len = 1 + Math.floor(rand() * 14);
    for (let i = 0; i < len; i++) {
      out.push(r < 0.4 ? 0.5 + rand() * 0.5 : r < 0.55 ? 0.35 + rand() * 0.149 : rand() * 0.349);
    }
  }
  return out.slice(0, frames);
}

/** The leg's whole 16 kHz timeline, resampled apart from the core. */
function timelineOf(chunks: Int16Array[]): Float32Array {
  const r = new TimelineResampler();
  const parts = chunks.map((c) => r.push(c));
  parts.push(r.flush());
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Where two runs of samples first differ, or null: toEqual over long float arrays is slow. */
function difference(a: Float32Array, b: Float32Array): string | null {
  if (a.length !== b.length) return `${a.length} samples, expected ${b.length}`;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return `sample ${i}: ${a[i]}, expected ${b[i]}`;
  return null;
}

const isSegment = (o: DetectorOutput): o is DetectorSegment => o.type === 'segment';

/** In frames, for reading. */
const span = (s: DetectorSegment) => ({
  start: s.start / FRAME,
  end: s.end / FRAME,
  endedBy: s.endedBy,
  ...(s.smartTurnProbability !== undefined ? { smartTurnProbability: s.smartTurnProbability } : {}),
});

interface HarnessOptions {
  vad?: Partial<VadWebConfig>;
  limit?: SegmentLimit;
  smart?: TurnDetectorCoreOptions['smart'];
  infer?: TurnDetectorCoreOptions['infer'];
  seed?: number;
}

/** A core and its assembler, as the worker wires them; `infer` answers `probs[i]` for the i-th frame it is asked about. */
function harness(probs: number[], o: HarnessOptions = {}) {
  const trace: TurnTrace[] = [];
  const outputs: DetectorOutput[] = [];
  const notices: DetectorNotice[] = [];
  /** Notices and trace events, in the order they came. */
  const events: Array<TurnTrace | DetectorNotice> = [];
  const inferred: Float32Array[] = [];
  const input: Int16Array[] = [];
  const rand = mulberry32(o.seed ?? 1);
  const ref: { core?: TurnDetectorCore } = {};
  const assembler: SegmentAssembler = new SegmentAssembler({
    post: (msg) => {
      outputs.push(msg);
      // The recognizer starts each segment as it arrives, so the decode queue (C3) stays empty here.
      if (msg.type === 'segment') queueMicrotask(() => assembler.taken({ type: 'taken', epoch: msg.epoch, seq: msg.seq }));
    },
    notify: (n) => notices.push(n),
    earliestNeeded: () => ref.core!.earliestNeeded(),
  });
  const core = new TurnDetectorCore({
    turns: 'auto',
    vad: { ...VAD, ...o.vad },
    limit: o.limit ?? {},
    infer: o.infer ?? (async (frame) => {
      inferred.push(frame.slice());
      return probs[inferred.length - 1] ?? SILENCE;
    }),
    smart: o.smart,
    trace: (e) => {
      trace.push(e);
      events.push(e);
      assembler.trace(e);
    },
    notify: (n) => {
      notices.push(n);
      events.push(n);
    },
  });
  ref.core = core;
  let sincePaced = 0;
  const push = (pcm: Int16Array) => {
    input.push(pcm);
    core.push(pcm);
  };
  return {
    core,
    assembler,
    trace,
    events,
    outputs,
    notices,
    inferred,
    push,
    noise: (samples: number) => noise(rand, samples),
    segments: () => outputs.filter(isSegment),
    timeline: () => timelineOf(input),
    /** Whole frames of audio, then waits for the core. */
    async feed(frames: number) {
      // In slices of at most a second: the detector fails a leg that holds more than 2 s unprocessed (C3).
      for (let left = frames * IN_FRAME; left > 0; left -= 24000) {
        push(noise(rand, Math.min(left, 24000)));
        await core.idle();
      }
    },
    /** Waits for the core once about a second has been pushed since the last wait. */
    async paced(samples: number) {
      sincePaced += samples;
      if (sincePaced < 24000) return;
      sincePaced = 0;
      await core.idle();
    },
  };
}

/** A Smart Turn port: requests are kept, answers arrive when the test sends them (or at once, with `auto`). */
class FakePort {
  onmessage: ((event: { data: TurnPredictAnswer }) => void) | null = null;
  readonly sent: TurnPredictRequest[] = [];
  constructor(private readonly auto?: (request: TurnPredictRequest) => TurnPredictAnswer) {}
  postMessage(message: TurnPredictRequest): void {
    this.sent.push(message);
    if (this.auto) this.answer(this.auto(message));
  }
  close(): void {}
  answer(data: TurnPredictAnswer): void {
    this.onmessage?.({ data });
  }
}

const smartVia = (port: FakePort, checkAfter: number): TurnDetectorCoreOptions['smart'] =>
  (processor) => openTurnLink(port as unknown as MessagePort, { smartTurn: { checkAfter, threshold: 0.5 } }, processor);

/** What a trace breaks of its rules, if anything. */
function traceProblems(trace: TurnTrace[]): string[] {
  const problems: string[] = [];
  let end = 0;
  let open: number | null = null;
  let lastClose = 0;
  let partial = false;
  trace.forEach((e, i) => {
    const bad = (what: string) => problems.push(`#${i} ${e.kind}: ${what}`);
    switch (e.kind) {
      case 'frame':
        if (partial) bad('a frame after a partial frame, before drained');
        if (e.from !== end) bad(`starts at ${e.from}, frames end at ${end}`);
        if (e.to - e.from !== e.samples.length) bad('interval and samples differ');
        if (e.samples.length === 0 || e.samples.length > FRAME) bad(`${e.samples.length} samples`);
        partial = e.samples.length < FRAME;
        end = e.to;
        break;
      case 'open':
        if (open !== null) bad('while a segment is open');
        if (e.at < lastClose) bad(`at ${e.at}, before the last close's end ${lastClose}`);
        if (e.at > end) bad('past the frames processed');
        open = e.at;
        break;
      case 'close':
        if (open !== e.from) bad(`from ${e.from}, open at ${open}`);
        if (e.from >= e.to) bad('empty');
        if (e.to > end) bad('past the frames processed');
        if (e.from < lastClose) bad('overlaps the last close');
        lastClose = e.to;
        open = null;
        break;
      case 'drop':
        if (open !== e.from) bad(`from ${e.from}, open at ${open}`);
        if (e.to < e.from || e.to > end) bad('out of the frames processed');
        open = null;
        break;
      case 'drained':
        if (open !== null) bad('with a segment open');
        partial = false;
        break;
      default:
        bad('not an automatic turn event');
    }
  });
  return problems;
}

describe('TurnDetectorCore — automatic turns', () => {
  it("a segment's audio is the FrameProcessor's own: pad, speech and the silence that ended it", async () => {
    let compared = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const probs = track(mulberry32(seed), 400);
      const h = harness(probs, { seed });
      await h.feed(probs.length);

      const timeline = h.timeline();
      let i = 0;
      const bare = new FrameProcessor(
        async () => ({ isSpeech: probs[i], notSpeech: 1 - probs[i] }),
        () => {},
        { positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35, redemptionMs: 128, minSpeechMs: 96, preSpeechPadMs: 64, submitUserSpeechOnPause: false },
        32,
      );
      bare.resume();
      const ends: Float32Array[] = [];
      for (i = 0; i < probs.length; i++) {
        await bare.process(timeline.slice(i * FRAME, (i + 1) * FRAME), (ev) => {
          if (ev.msg === Message.SpeechEnd) ends.push(ev.audio);
        });
      }

      const segments = h.segments();
      expect(segments.length, `seed ${seed}`).toBe(ends.length);
      segments.forEach((s, k) => expect(difference(s.audio, ends[k]), `seed ${seed} segment ${k}`).toBeNull());
      expect(segments.every((s) => s.endedBy === 'silence')).toBe(true);
      compared += ends.length;
    }
    expect(compared).toBeGreaterThan(100);
  });

  it("start and end are positions on the leg's timeline: end − start = audio.length", async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rand = mulberry32(seed);
      const h = harness(track(rand, 300), { seed });
      let sent = 0;
      while (sent < 300 * IN_FRAME) {
        const n = 1 + Math.floor(rand() * 3000);
        h.push(h.noise(n));
        sent += n;
        await h.paced(n);
      }
      h.core.drain();
      await h.core.idle();

      const timeline = h.timeline();
      expect(h.segments().length).toBeGreaterThan(0);
      for (const s of h.segments()) {
        expect(s.end - s.start).toBe(s.audio.length);
        expect(difference(s.audio, timeline.subarray(s.start, s.end)), `seed ${seed} segment ${s.seq}`).toBeNull();
      }
    }
  });

  it('a misfire is dropped: no segment', async () => {
    const h = harness([...run(3, SILENCE), ...run(2, SPEECH), ...run(6, SILENCE)]);
    await h.feed(11);
    expect(h.segments()).toEqual([]);
    expect(h.events.filter((e) => !('kind' in e && e.kind === 'frame'))).toEqual([
      { type: 'speech_start' },
      { kind: 'open', at: 1 * FRAME },
      { kind: 'drop', from: 1 * FRAME, to: 9 * FRAME },
    ]);
  });

  it('the cap cuts at resolveMaxSpeechFrames(maxSpeech, prePad, limit) speech frames', async () => {
    const limit = { maxSpeechSeconds: 1 };
    expect(resolveMaxSpeechFrames(30, 64, limit)).toBe(32);
    const h = harness([...run(3, SILENCE), ...run(40, SPEECH), ...run(6, SILENCE)], { limit });
    await h.feed(49);
    // Speech from frame 3: its 32nd frame is 34. The rest of the speech goes on in the same turn.
    expect(h.segments().map(span)).toEqual([
      { start: 1, end: 35, endedBy: 'cap' },
      { start: 35, end: 47, endedBy: 'silence' },
    ]);
    expect(h.segments()[0].audio.length).toBe((2 + 32) * FRAME);
  });

  it('after a cap, 200 ms more speech then silence is one more segment from the cut: no pad, not dropped as a misfire', async () => {
    // minSpeech 0.4 s (12 frames): on its own, 6 frames of speech would be a misfire.
    const h = harness([...run(3, SILENCE), ...run(32 + 6, SPEECH), ...run(6, SILENCE)], {
      limit: { maxSpeechSeconds: 1 },
      vad: { minSpeechDuration: 0.4 },
    });
    await h.feed(47);
    const [first, second] = h.segments();
    const cut = first.end;
    expect(h.segments().map(span)).toEqual([
      { start: 1, end: 35, endedBy: 'cap' },
      { start: 35, end: 35 + 6 + 4, endedBy: 'silence' },
    ]);
    expect(second.start).toBe(cut);
    expect(second.end).toBe(cut + 6 * FRAME + 4 * FRAME);
    expect(second.audio).toEqual(h.timeline().slice(cut, cut + 10 * FRAME));
  });

  it('after a cap, silence alone ends the turn with nothing more', async () => {
    const h = harness([...run(3, SILENCE), ...run(32, SPEECH), ...run(20, SILENCE)], { limit: { maxSpeechSeconds: 1 } });
    await h.feed(55);
    expect(h.segments().map(span)).toEqual([{ start: 1, end: 35, endedBy: 'cap' }]);
    expect(h.trace.filter((e) => e.kind === 'open' || e.kind === 'drop')).toEqual([
      { kind: 'open', at: 1 * FRAME },
      { kind: 'open', at: 35 * FRAME },
      { kind: 'drop', from: 35 * FRAME, to: 39 * FRAME },
    ]);
  });

  it('after a cap, a tail that Normal\'s silence ends is one more segment, and the next starts at its end, not inside it', async () => {
    // Gray after the cut: heard, but no speech for the processor. The processor's pad for the next
    // speech (frames 40-41) lies inside that tail; the next segment starts where the tail ended.
    const h = harness([...run(3, SILENCE), ...run(32, SPEECH), ...run(3, GRAY), ...run(4, SILENCE), ...run(5, SPEECH), ...run(4, SILENCE)], {
      limit: { maxSpeechSeconds: 1 },
    });
    await h.feed(51);
    expect(h.segments().map(span)).toEqual([
      { start: 1, end: 35, endedBy: 'cap' },
      { start: 35, end: 42, endedBy: 'silence' },
      { start: 42, end: 51, endedBy: 'silence' },
    ]);
  });

  it('a cut on the frame speech started at leaves the processor no pad: the next segment starts after it', async () => {
    // A one-frame cap (3 frames for the segment, 2 of them pad) under a 3-frame minSpeech: each cut is a misfire.
    const limit = { maxSegmentSamples: 3 * FRAME };
    expect(resolveMaxSpeechFrames(30, 64, limit)).toBe(1);
    const h = harness([...run(3, SILENCE), SPEECH, SPEECH], { limit });
    await h.feed(5);
    expect(h.trace.filter((e) => e.kind === 'open' || e.kind === 'drop')).toEqual([
      { kind: 'open', at: 1 * FRAME },
      { kind: 'drop', from: 1 * FRAME, to: 4 * FRAME },
      { kind: 'open', at: 4 * FRAME },
      { kind: 'drop', from: 4 * FRAME, to: 5 * FRAME },
    ]);
  });

  it('a continuation never outgrows the longest segment the processor can cut: pad + cap frames from the cut', async () => {
    // Redemption 10: after the cut, 5 quiet frames keep the turn open, more than the 2-frame pad the
    // processor would have kept. Counted from its own speech start, the cap would cut at frame 71.
    const h = harness([...run(3, SILENCE), ...run(32, SPEECH), ...run(5, SILENCE), ...run(40, SPEECH), ...run(12, SILENCE)], {
      limit: { maxSpeechSeconds: 1 },
      vad: { minSilenceDuration: 0.32 },
    });
    await h.feed(92);
    expect(h.segments().map(span)).toEqual([
      { start: 1, end: 35, endedBy: 'cap' },
      { start: 35, end: 69, endedBy: 'cap' },
      { start: 69, end: 90, endedBy: 'silence' },
    ]);
    expect(h.segments().every((s) => s.audio.length <= (2 + 32) * FRAME)).toBe(true);
  });

  it("Smart ends a segment at the frame after its answer, endedBy 'smart' with the probability", async () => {
    let answer: number | null = null;
    const link: SmartLink = {
      afterFrame: () => {
        const a = answer;
        answer = null;
        return a;
      },
      rescue: () => null,
      reset: () => {},
      close: () => {},
    };
    const h = harness([...run(3, SILENCE), ...run(5, SPEECH), ...run(10, SILENCE)], { smart: () => link });
    await h.feed(10);
    expect(h.segments()).toEqual([]);
    answer = 0.8;
    await h.feed(1);
    // Normal would have ended it at its 4th quiet frame, 11.
    expect(h.segments().map(span)).toEqual([{ start: 1, end: 11, endedBy: 'smart', smartTurnProbability: 0.8 }]);
    await h.feed(7);
    expect(h.segments()).toHaveLength(1);
  });

  it('a Smart answer for an earlier segment never ends the next one', async () => {
    const port = new FakePort();
    const h = harness([...run(3, SILENCE), ...run(5, SPEECH), ...run(4, SILENCE), ...run(2, SILENCE), ...run(5, SPEECH), ...run(10, SILENCE)], {
      smart: smartVia(port, 0.064),
    });
    await h.feed(10);
    const [first] = port.sent;
    expect(port.sent).toHaveLength(1);
    await h.feed(2 + 2 + 5 + 2);
    expect(port.sent).toHaveLength(2);
    port.answer({ id: first.id, probability: 0.9 });
    await h.feed(4);
    expect(h.segments().map(span)).toEqual([
      { start: 1, end: 12, endedBy: 'silence' },
      { start: 12, end: 23, endedBy: 'silence' },
    ]);
  });

  it('Smart failing or answering late: Normal still ends the segment', async () => {
    const probs = [...run(3, SILENCE), ...run(5, SPEECH), ...run(4, SILENCE), ...run(2, SILENCE), ...run(5, SPEECH), ...run(6, SILENCE)];
    const normal = [
      { start: 1, end: 12, endedBy: 'silence' },
      { start: 12, end: 23, endedBy: 'silence' },
    ];
    const variants: Array<{ name: string; asked?: (port: FakePort) => void; ended?: (port: FakePort) => void }> = [
      { name: 'never answers' },
      { name: 'fails', asked: (port) => port.answer({ id: port.sent[0].id, error: 'inference failed' }) },
      { name: 'answers after the processor ended the segment', ended: (port) => port.answer({ id: port.sent[0].id, probability: 0.95 }) },
    ];
    for (const { name, asked, ended } of variants) {
      const port = new FakePort();
      const h = harness(probs, { smart: smartVia(port, 0.064) });
      await h.feed(10);
      expect(port.sent, name).toHaveLength(1);
      asked?.(port);
      await h.feed(2);
      expect(h.segments(), name).toHaveLength(1);
      ended?.(port);
      await h.feed(probs.length - 12);
      expect(h.segments().map(span), name).toEqual(normal);
    }
    const missing = harness(probs, { smart: () => null });
    await missing.feed(probs.length);
    expect(missing.segments().map(span)).toEqual(normal);
  });

  it("a misfire after a Smart end inside Normal's wait is kept", async () => {
    // Redemption 10; Smart asks at the 4th quiet frame and its answer ends the sentence at the 5th.
    const port = new FakePort();
    const h = harness([...run(3, SILENCE), ...run(5, SPEECH), ...run(5, SILENCE), ...run(4, SILENCE), ...run(2, SPEECH), ...run(10, SILENCE)], {
      vad: { minSilenceDuration: 0.32 },
      smart: smartVia(port, 0.1),
    });
    await h.feed(12);
    expect(port.sent).toHaveLength(1);
    port.answer({ id: port.sent[0].id, probability: 0.9 });
    await h.feed(17);
    expect(h.segments().map(span)).toEqual([
      { start: 1, end: 13, endedBy: 'smart', smartTurnProbability: 0.9 },
      // The reply at 17, its 2-frame pad, and the silence that ended it.
      { start: 15, end: 29, endedBy: 'kept' },
    ]);
  });

  it("drain: the partial frame is padded for the VAD only; the closing segment holds its real samples, endedBy 'flush', then drained", async () => {
    const h = harness([...run(3, SILENCE), ...run(5, SPEECH), SPEECH]);
    h.push(h.noise(8 * IN_FRAME + 450)); // 8 frames and 300 samples at 16 kHz
    await h.core.idle();
    expect(h.inferred).toHaveLength(8);
    h.core.drain();
    await h.core.idle();

    const timeline = h.timeline();
    expect(timeline.length).toBe(8 * FRAME + 300);
    const padded = h.inferred[8];
    expect(padded.length).toBe(FRAME);
    expect(padded.subarray(0, 300)).toEqual(timeline.subarray(8 * FRAME));
    expect(padded.subarray(300).every((v) => v === 0)).toBe(true);

    const [frame, close, drained] = h.trace.slice(-3);
    expect(frame).toMatchObject({ kind: 'frame', from: 8 * FRAME, to: 8 * FRAME + 300 });
    expect(frame.kind === 'frame' && frame.samples.length).toBe(300);
    expect(close).toEqual({ kind: 'close', from: FRAME, to: 8 * FRAME + 300, endedBy: 'flush' });
    expect(drained).toEqual({ kind: 'drained' });

    expect(h.outputs.map((o) => o.type)).toEqual(['segment', 'drained']);
    const [segment] = h.segments();
    expect(segment).toMatchObject({ start: FRAME, end: 8 * FRAME + 300, endedBy: 'flush' });
    expect(segment.audio).toEqual(timeline.slice(FRAME));
  });

  it('a drain with nothing open emits only drained', async () => {
    const quiet = harness(run(6, SILENCE));
    quiet.push(quiet.noise(5 * IN_FRAME + 300));
    quiet.core.drain();
    await quiet.core.idle();
    expect(quiet.outputs).toEqual([{ type: 'drained', epoch: 1, seq: 1 }]);

    const ended = harness([...run(3, SILENCE), ...run(5, SPEECH), ...run(4, SILENCE)]);
    await ended.feed(12);
    expect(ended.segments()).toHaveLength(1);
    ended.core.drain();
    await ended.core.idle();
    expect(ended.outputs.slice(1)).toEqual([{ type: 'drained', epoch: 1, seq: 2 }]);
  });

  it('two cores fed interleaved keep their positions, state and output apart', async () => {
    const rand = mulberry32(42);
    const legs = [track(rand, 250), track(rand, 250)];
    const chunks = legs.map(() => {
      const out: Int16Array[] = [];
      let sent = 0;
      while (sent < 250 * IN_FRAME) {
        const n = 1 + Math.floor(rand() * 2500);
        out.push(noise(rand, n));
        sent += n;
      }
      return out;
    });

    const alone: Array<ReturnType<typeof harness>> = [];
    for (let leg = 0; leg < 2; leg++) {
      const h = harness(legs[leg]);
      for (const c of chunks[leg]) {
        h.push(c);
        await h.paced(c.length);
      }
      h.core.drain();
      await h.core.idle();
      alone.push(h);
    }

    const together = [harness(legs[0]), harness(legs[1])];
    for (let i = 0; i < Math.max(chunks[0].length, chunks[1].length); i++) {
      for (let leg = 0; leg < 2; leg++) {
        if (!chunks[leg][i]) continue;
        together[leg].push(chunks[leg][i]);
        await together[leg].paced(chunks[leg][i].length);
      }
    }
    together.forEach((h) => h.core.drain());
    await Promise.all(together.map((h) => h.core.idle()));

    for (let leg = 0; leg < 2; leg++) {
      expect(alone[leg].segments().length).toBeGreaterThan(0);
      expect(together[leg].trace).toEqual(alone[leg].trace);
      expect(together[leg].outputs).toEqual(alone[leg].outputs);
      expect(together[leg].notices).toEqual(alone[leg].notices);
    }
    expect(together[0].outputs).not.toEqual(together[1].outputs);
  });

  it('the trace is well formed on random input', async () => {
    const problems: string[] = [];
    let closes = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const rand = mulberry32(seed);
      const probs = track(rand, 60 + Math.floor(rand() * 240));
      const limit = [{}, { maxSpeechSeconds: 0.5 }, { maxSpeechSeconds: 1 }][Math.floor(rand() * 3)];
      const port = rand() < 0.5 ? new FakePort((r) => ({ id: r.id, probability: rand() })) : null;
      const h = harness(probs, {
        seed,
        limit,
        vad: { minSilenceDuration: rand() < 0.5 ? 0.128 : 0.32 },
        smart: port ? smartVia(port, 0.064) : undefined,
      });
      let drains = 0;
      for (let sent = 0; sent < probs.length * IN_FRAME;) {
        const n = 1 + Math.floor(rand() * 3000);
        h.push(h.noise(n));
        sent += n;
        await h.paced(n);
        if (rand() < 0.1) {
          h.core.drain();
          drains++;
        }
      }
      h.core.drain();
      drains++;
      await h.core.idle();

      const timeline = h.timeline();
      for (const p of traceProblems(h.trace)) problems.push(`seed ${seed} ${p}`);
      const last = [...h.trace].reverse().find((e) => e.kind === 'frame');
      if (!last || last.kind !== 'frame' || last.to !== timeline.length) problems.push(`seed ${seed}: the frames do not cover the timeline`);
      if (h.outputs.filter((o) => o.type === 'drained').length !== drains) problems.push(`seed ${seed}: drains`);
      const traced = h.trace.filter((e) => e.kind === 'close').length;
      if (h.segments().length !== traced) problems.push(`seed ${seed}: ${traced} closes, ${h.segments().length} segments`);
      for (const s of h.segments()) {
        if (s.end - s.start !== s.audio.length) problems.push(`seed ${seed}: segment ${s.seq} length`);
        const differs = difference(s.audio, timeline.subarray(s.start, s.end));
        if (differs) problems.push(`seed ${seed}: segment ${s.seq} ${differs}`);
      }
      closes += traced;
    }
    expect(problems.slice(0, 10)).toEqual([]);
    expect(closes).toBeGreaterThan(300);
  });

  it("earliestNeeded: the open segment's start, else the pad the processor holds, never before the last close", async () => {
    const h = harness([...run(10, SILENCE), ...run(5, SPEECH), ...run(4, SILENCE), ...run(6, SILENCE)]);
    await h.feed(10);
    expect(h.core.earliestNeeded()).toBe(8 * FRAME);
    await h.feed(5);
    expect(h.core.earliestNeeded()).toBe(8 * FRAME);
    await h.feed(4);
    expect(h.segments().map(span)).toEqual([{ start: 8, end: 19, endedBy: 'silence' }]);
    expect(h.core.earliestNeeded()).toBe(19 * FRAME);
    await h.feed(1);
    expect(h.core.earliestNeeded()).toBe(19 * FRAME);
    await h.feed(5);
    expect(h.core.earliestNeeded()).toBe(23 * FRAME);
  });

  it('Silero failing fails the leg once with turn_detection_unavailable; nothing more is processed', async () => {
    let calls = 0;
    const h = harness([], {
      infer: async () => {
        if (++calls === 5) throw new Error('session lost');
        return SILENCE;
      },
    });
    await h.feed(8);
    await h.feed(8);
    expect(calls).toBe(5);
    expect(h.notices).toEqual([{ type: 'failed', code: 'turn_detection_unavailable', message: expect.stringContaining('session lost') }]);
    h.core.drain();
    await h.core.idle();
    expect(h.outputs).toEqual([]);
  });
});

/** A core under manual turns, with its assembler. 24 kHz input: 1.5 input samples per output sample. */
const manualTraces: TurnTrace[][] = [];

/**
 * Press traces: every open ends in exactly one close, drop or cancel before the next open, and nothing ends without an open. No frame sizes.
 * A cancel ends the open only when it names the open's press; any other cancel only names a press that is already over.
 */
function pressTraceProblems(trace: TurnTrace[]): string[] {
  const problems: string[] = [];
  let open: { press?: number } | null = null;
  trace.forEach((e, i) => {
    if (e.kind === 'open') {
      if (open) problems.push(`#${i} open while a segment is open`);
      open = { press: e.press };
    } else if (e.kind === 'close' || e.kind === 'drop') {
      if (!open) problems.push(`#${i} ${e.kind} with no open`);
      open = null;
    } else if (e.kind === 'cancel' && open && open.press === e.press) {
      open = null;
    }
  });
  if (open) problems.push('an open never ended');
  return problems;
}

function manual(o: { limit?: SegmentLimit; maxSpeech?: number } = {}) {
  const trace: TurnTrace[] = [];
  manualTraces.push(trace);
  const outputs: DetectorOutput[] = [];
  let infers = 0;
  const rand = mulberry32(7);
  const input: Int16Array[] = [];
  const ref: { core?: TurnDetectorCore } = {};
  const assembler = new SegmentAssembler({
    post: (msg) => outputs.push(msg),
    notify: () => {},
    earliestNeeded: () => ref.core!.earliestNeeded(),
  });
  const core = new TurnDetectorCore({
    turns: 'manual',
    vad: { ...VAD, maxSpeechDuration: o.maxSpeech ?? 30 },
    limit: o.limit ?? {},
    infer: async () => {
      infers++;
      return SPEECH;
    },
    trace: (e) => {
      trace.push(e);
      assembler.trace(e);
    },
    notify: () => {},
  });
  ref.core = core;
  return {
    core,
    trace,
    infers: () => infers,
    segments: () => outputs.filter(isSegment),
    outputs,
    timeline: () => timelineOf(input),
    /** `samples` 16 kHz samples' worth of input. */
    async push(samples: number, amplitude = 30000) {
      // In slices of at most a second: the detector fails a leg that holds more than 2 s unprocessed (C3).
      for (let left = samples * 1.5; left > 0; left -= 24000) {
        const pcm = new Int16Array(Math.min(left, 24000));
        for (let i = 0; i < pcm.length; i++) pcm[i] = Math.floor((rand() * 2 - 1) * amplitude);
        input.push(pcm);
        core.push(pcm);
        await core.idle();
      }
    },
    async settle() {
      await core.idle();
    },
  };
}

describe('TurnDetectorCore — presses', () => {
  afterEach(() => {
    const all = manualTraces.splice(0).map(pressTraceProblems);
    all.forEach((problems) => expect(problems).toEqual([]));
  });

  it('under manual turns Silero is never asked', async () => {
    const m = manual();
    m.core.begin(1);
    await m.push(5000);
    m.core.drain();
    await m.settle();
    expect(m.infers()).toBe(0);
    expect(m.segments()).toHaveLength(1);
  });

  it("a press is one segment of every sample from begin to release, endedBy 'release': quiet speech is not dropped", async () => {
    const m = manual();
    m.core.begin(1);
    await m.push(FRAME * 40, 200); // amplitude 200/32768: under Silero's threshold, a few frames of it
    m.core.drain();
    await m.settle();
    const [s, ...rest] = m.segments();
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ press: 1, start: 0, end: FRAME * 40, endedBy: 'release' });
    expect(difference(s.audio, m.timeline())).toBeNull();
    expect(s.smartTurnProbability).toBeUndefined();
  });

  it('a 500 ms press: 8000 samples, one segment of 8000; the 320 after the last whole frame come at release, not later', async () => {
    const m = manual();
    m.core.begin(1);
    await m.push(8000);
    // The partial frame has not been delivered: only the whole ones are in the trace.
    const framed = () => m.trace.filter((e) => e.kind === 'frame').reduce((n, e) => n + (e as { samples: Float32Array }).samples.length, 0);
    expect(framed()).toBe(15 * FRAME);
    expect(m.segments()).toEqual([]);
    m.core.drain();
    await m.settle();
    expect(framed()).toBe(8000);
    const frames = m.trace.filter((e) => e.kind === 'frame');
    expect((frames[frames.length - 1] as { samples: Float32Array }).samples).toHaveLength(320);
    expect(m.segments().map((s) => [s.start, s.end, s.audio.length, s.endedBy])).toEqual([[0, 8000, 8000, 'release']]);
    expect(difference(m.segments()[0].audio, m.timeline())).toBeNull();
    expect(m.outputs[m.outputs.length - 1]).toMatchObject({ type: 'drained' });
  });

  it('a press holding fewer than 512 samples is one segment of exactly those samples', async () => {
    const m = manual();
    m.core.begin(4);
    await m.push(300);
    m.core.drain();
    await m.settle();
    expect(m.segments().map((s) => [s.press, s.start, s.end, s.audio.length])).toEqual([[4, 0, 300, 300]]);
    expect(difference(m.segments()[0].audio, m.timeline())).toBeNull();
  });

  it("a cancelled press's partial frame is traced before the next press opens; the next press holds none of its samples", async () => {
    const m = manual();
    m.core.begin(1);
    await m.push(FRAME * 3 + 200); // three frames and a tail under a frame
    m.core.cancel(1);
    m.core.begin(2);
    await m.push(FRAME * 2);
    m.core.drain();
    await m.settle();
    const open2 = m.trace.findIndex((e) => e.kind === 'open' && e.press === 2);
    const before = m.trace.slice(0, open2).filter((e) => e.kind === 'frame') as Array<{ from: number; to: number }>;
    expect(before[before.length - 1]).toMatchObject({ from: FRAME * 3, to: FRAME * 3 + 200 });
    expect(m.trace[open2]).toMatchObject({ at: FRAME * 3 + 200 });
    expect(m.segments().filter((s) => s.press === 2).map((s) => [s.start, s.end])).toEqual([[FRAME * 3 + 200, FRAME * 5 + 200]]);
    const s2 = m.segments().find((s) => s.press === 2)!;
    expect(difference(s2.audio, m.timeline().subarray(FRAME * 3 + 200))).toBeNull();
  });

  it('a Whisper press of 463872 + 3200 samples: [0, 463872) cap and [463872, 467072) release, both of the press, the tail decoded once', async () => {
    const m = manual({ limit: { maxSegmentSamples: 464000 }, maxSpeech: 30 });
    m.core.begin(9);
    await m.push(463872);
    await m.push(3200);
    m.core.drain();
    await m.settle();
    expect(m.segments().map((s) => [s.press, s.start, s.end, s.endedBy])).toEqual([
      [9, 0, 463872, 'cap'],
      [9, 463872, 467072, 'release'],
    ]);
    expect(m.segments().map((s) => s.seq)).toEqual([1, 2]);
    const timeline = m.timeline();
    expect(difference(m.segments()[0].audio, timeline.slice(0, 463872))).toBeNull();
    expect(difference(m.segments()[1].audio, timeline.slice(463872))).toBeNull();
    expect(m.trace.filter((e) => e.kind === 'open')).toEqual([
      { kind: 'open', at: 0, press: 9 },
      { kind: 'open', at: 463872, press: 9 },
    ]);
  });

  it('a release right after a cap emits only drained', async () => {
    const m = manual({ limit: { maxSegmentSamples: 464000 } });
    m.core.begin(1);
    await m.push(463872);
    m.core.drain();
    await m.settle();
    expect(m.outputs.map((o) => [o.type, o.type === 'segment' ? o.endedBy : null])).toEqual([
      ['segment', 'cap'],
      ['drained', null],
    ]);
    expect(m.trace.filter((e) => e.kind === 'open' || e.kind === 'close' || e.kind === 'drop')).toEqual([
      { kind: 'open', at: 0, press: 1 },
      { kind: 'close', from: 0, to: 463872, endedBy: 'cap', press: 1 },
      { kind: 'open', at: 463872, press: 1 },
      { kind: 'drop', from: 463872, to: 463872 },
    ]);
  });

  it('begin(p+1) while press p has taken no audio drops the empty segment in the trace and emits no segment', async () => {
    const m = manual();
    m.core.begin(1);
    m.core.begin(2);
    await m.push(1000);
    m.core.drain();
    await m.settle();
    expect(m.segments().map((s) => [s.press, s.start, s.end])).toEqual([[2, 0, 1000]]);
    expect(m.outputs.map((o) => o.type)).toEqual(['segment', 'drained']);
    expect(m.trace.filter((e) => e.kind === 'open' || e.kind === 'close' || e.kind === 'drop')).toEqual([
      { kind: 'open', at: 0, press: 1 },
      { kind: 'drop', from: 0, to: 0 },
      { kind: 'open', at: 0, press: 2 },
      { kind: 'close', from: 0, to: 1000, endedBy: 'release', press: 2 },
    ]);
  });

  it('begin then drain with no audio drops the empty segment in the trace and emits only drained', async () => {
    const m = manual();
    m.core.begin(1);
    m.core.drain();
    await m.settle();
    expect(m.outputs.map((o) => o.type)).toEqual(['drained']);
    expect(m.trace.filter((e) => e.kind === 'open' || e.kind === 'close' || e.kind === 'drop')).toEqual([
      { kind: 'open', at: 0, press: 1 },
      { kind: 'drop', from: 0, to: 0 },
    ]);
  });

  it('cancel drops the open audio and emits cancel{press}; nothing more of that press', async () => {
    const m = manual();
    m.core.begin(3);
    await m.push(2000);
    m.core.cancel(3);
    await m.push(1000); // outside any press
    m.core.drain();
    await m.settle();
    expect(m.segments()).toEqual([]);
    expect(m.trace.filter((e) => e.kind === 'close')).toEqual([]);
    expect(m.outputs.map((o) => o.type)).toEqual(['cancel', 'drained']);
    expect(m.outputs[0]).toMatchObject({ press: 3 });
  });

  it('a press cancelled after its release is still named by the cancel', async () => {
    const m = manual();
    m.core.begin(1);
    await m.push(2000);
    m.core.begin(2); // releases 1
    await m.push(1000);
    m.core.cancel(1);
    m.core.drain();
    await m.settle();
    expect(m.outputs.map((o) => [o.type, 'press' in o ? o.press : null])).toEqual([
      ['segment', 1],
      ['cancel', 1],
      ['segment', 2],
      ['drained', null],
    ]);
  });

  it("quick repeated presses: each segment carries its own press, and no sample of press 1 is in press 2's", async () => {
    const m = manual();
    m.core.begin(1);
    await m.push(1000); // 1000 = 1 frame + 488: a partial frame in hand when press 2 begins
    m.core.begin(2);
    await m.push(700);
    m.core.begin(3);
    await m.push(2048);
    m.core.drain();
    await m.settle();
    const segments = m.segments();
    expect(segments.map((s) => [s.press, s.start, s.end, s.endedBy])).toEqual([
      [1, 0, 1000, 'release'],
      [2, 1000, 1700, 'release'],
      [3, 1700, 3748, 'release'],
    ]);
    const timeline = m.timeline();
    segments.forEach((s) => expect(difference(s.audio, timeline.slice(s.start, s.end))).toBeNull());
  });

  it('audio outside a press counts on the timeline and is no segment; positions keep counting through presses and cancels', async () => {
    const m = manual();
    await m.push(1300);
    m.core.begin(1);
    await m.push(600);
    m.core.cancel(1);
    await m.push(500);
    m.core.begin(2);
    await m.push(900);
    m.core.drain();
    await m.settle();
    expect(m.segments().map((s) => [s.press, s.start, s.end])).toEqual([[2, 2400, 3300]]);
    expect(difference(m.segments()[0].audio, m.timeline().slice(2400, 3300))).toBeNull();
    expect(m.trace.filter((e) => e.kind === 'open')).toEqual([
      { kind: 'open', at: 1300, press: 1 },
      { kind: 'open', at: 2400, press: 2 },
    ]);
    // Every sample is in a frame, press or not.
    const framed = m.trace.filter((e) => e.kind === 'frame').reduce((n, e) => n + (e as { samples: Float32Array }).samples.length, 0);
    expect(framed).toBe(3300);
  });
});

describe('TurnDetectorCore — bounds, stop', () => {
  /** An infer that answers only when the test lets it. */
  function held() {
    const waiting: Array<(p: number) => void> = [];
    let calls = 0;
    return {
      infer: () => {
        calls++;
        return new Promise<number>((resolve) => waiting.push(resolve));
      },
      calls: () => calls,
      release: async (p = SILENCE) => {
        while (waiting.length) {
          waiting.shift()!(p);
          await new Promise((r) => setTimeout(r, 0));
        }
      },
    };
  }
  const overloaded = { type: 'failed', code: 'turn_detection_overloaded', message: 'Turn detection cannot keep up on this device.' };

  it('input slower than real time: past 2 s unprocessed the leg fails once and processes nothing more', async () => {
    const gate = held();
    const h = harness([], { infer: gate.infer });
    h.push(new Int16Array(24000 * 2.1));
    expect(h.notices).toEqual([overloaded]);
    h.push(new Int16Array(24000));
    h.core.drain();
    await gate.release();
    await h.core.idle();
    expect(h.notices).toEqual([overloaded]);
    expect(gate.calls()).toBe(0);
    expect(h.trace).toEqual([]);
  });

  it('chunks that add up: the leg fails once the unprocessed total passes 2 s, not before', async () => {
    const gate = held();
    const h = harness([], { infer: gate.infer });
    for (let i = 0; i < 100; i++) h.push(new Int16Array(480)); // 2 s exactly in 20 ms chunks
    expect(h.notices).toEqual([]);
    h.push(new Int16Array(480));
    expect(h.notices).toEqual([overloaded]);
    await gate.release();
    await h.core.idle();
    expect(gate.calls()).toBeLessThanOrEqual(1); // only the frame in hand
    expect(h.trace).toEqual([]);
    expect(h.notices).toHaveLength(1);
  });

  it('exactly 2 s unprocessed does not fail', async () => {
    const gate = held();
    const h = harness([], { infer: gate.infer });
    h.push(new Int16Array(24000 * 2));
    expect(h.notices).toEqual([]);
    await gate.release();
    await h.core.idle();
    expect(h.notices).toEqual([]);
    expect(gate.calls()).toBe(Math.floor((16000 * 2) / FRAME));
  });

  it('counts the input actually received: one sample, then 47 999, is exactly 2 s at 24 kHz and passes; one more fails', async () => {
    const gate = held();
    const h = harness([], { infer: gate.infer });
    h.push(new Int16Array(1));
    h.push(new Int16Array(47999));
    expect(h.notices).toEqual([]);
    h.push(new Int16Array(1));
    expect(h.notices).toEqual([overloaded]);
    await gate.release();
    await h.core.idle();
  });

  it('an overload, then the rejection of the inference held at that moment: still one notice, the overload', async () => {
    let reject: ((e: Error) => void) | null = null;
    const h = harness([], { infer: () => new Promise<number>((_, rej) => { reject = rej; }) });
    h.push(new Int16Array(12000)); // the first frame's inference starts and is held
    h.push(new Int16Array(24000 * 1.7)); // the unprocessed total passes 2 s
    expect(h.notices).toEqual([overloaded]);
    reject!(new Error('late failure'));
    await h.core.idle();
    expect(h.notices).toEqual([overloaded]);
  });

  it('the rejection of an inference that stop() ended is not the new turn\'s failure: the leg goes on with what queued behind it', async () => {
    let calls = 0;
    let rejectFirst: ((e: Error) => void) | null = null;
    const h = harness([], {
      infer: () => {
        calls++;
        if (calls === 1) return new Promise<number>((_, rej) => { rejectFirst = rej; });
        return Promise.resolve(SILENCE);
      },
    });
    h.push(h.noise(IN_FRAME));
    h.core.stop();
    h.push(h.noise(IN_FRAME));
    rejectFirst!(new Error('session lost while stopped'));
    await h.core.idle();
    expect(h.notices).toEqual([]);
    expect(calls).toBe(2);
    expect(h.trace.some((e) => e.kind === 'frame')).toBe(true);
  });

  it('a rejection of the active generation still fails the leg', async () => {
    const h = harness([], { infer: async () => { throw new Error('boom'); } });
    h.push(h.noise(IN_FRAME));
    await h.core.idle();
    expect(h.notices).toEqual([{ type: 'failed', code: 'turn_detection_unavailable', message: 'Turn detection failed: boom' }]);
  });

  it('stop with a backlog returns at once: queued input dropped, nothing more posted, late taken ignored', async () => {
    const gate = held();
    const h = harness([], { infer: gate.infer });
    h.push(h.noise(IN_FRAME * 20));
    h.push(h.noise(IN_FRAME * 20));
    h.core.drain();
    await new Promise((r) => setTimeout(r, 0));
    expect(gate.calls()).toBe(1);
    h.core.stop();
    h.assembler.stop(2);
    await gate.release(SPEECH); // the frame in hand answers late
    await h.core.idle();
    h.assembler.taken({ type: 'taken', epoch: 1, seq: 1 }); // late, of the old epoch: ignored
    expect(gate.calls()).toBe(1);
    expect(h.trace).toEqual([]); // nothing of the old epoch, drained included
    expect(h.outputs).toEqual([]);
    expect(h.notices).toEqual([]);
  });

  it('after stop, the core takes new audio on the timeline from where it processed: positions are contiguous, and the old speech is forgotten', async () => {
    const h = harness([...run(6, SPEECH), ...run(40, SILENCE)]);
    await h.feed(3); // speech starts, no segment closed
    h.core.stop();
    await h.core.idle();
    await h.feed(20);
    const frames = h.trace.filter((e): e is Extract<TurnTrace, { kind: 'frame' }> => e.kind === 'frame');
    frames.forEach((f, i) => expect(f.from).toBe(i * FRAME));
    // The speech frames processed after the stop are the new epoch's own; no error, no failure.
    expect(h.notices.filter((n) => n.type === 'failed')).toEqual([]);
  });

  it('a failure of the core after an overload does not report a second notice', async () => {
    const h = harness([], { infer: async () => { throw new Error('boom'); } });
    h.push(h.noise(IN_FRAME * 2));
    await h.core.idle();
    expect(h.notices).toEqual([{ type: 'failed', code: 'turn_detection_unavailable', message: 'Turn detection failed: boom' }]);
  });
});

describe('TurnDetectorCore — the engine limit alone cuts a press; the pad fits the limit', () => {
  it('a press is not shortened by the automatic Max speech setting: 6 frames under a 0.032 s setting and an 8-frame limit are one segment', async () => {
    const m = manual({ maxSpeech: 0.032, limit: { maxSegmentSamples: 8 * FRAME } });
    m.core.begin(1);
    await m.push(FRAME * 6);
    m.core.drain();
    await m.settle();
    expect(m.segments().map((s) => [s.start, s.end, s.endedBy])).toEqual([[0, FRAME * 6, 'release']]);
  });

  it('a press is still cut where it reaches the engine limit, and goes on as the same press', async () => {
    const m = manual({ maxSpeech: 0.032, limit: { maxSegmentSamples: 8 * FRAME } });
    m.core.begin(1);
    await m.push(FRAME * 10);
    m.core.drain();
    await m.settle();
    expect(m.segments().map((s) => [s.press, s.start, s.end, s.endedBy])).toEqual([[1, 0, FRAME * 8, 'cap'], [1, FRAME * 8, FRAME * 10, 'release']]);
  });

  it('with no engine limit a press is never cut', async () => {
    const m = manual({ maxSpeech: 0.032 });
    m.core.begin(1);
    await m.push(FRAME * 100);
    m.core.drain();
    await m.settle();
    expect(m.segments()).toHaveLength(1);
  });

  it('an automatic pre-pad that leaves no room for speech inside the engine\'s limit is shortened: no segment passes it', async () => {
    const h = harness([...run(40, SILENCE), ...run(3, SPEECH), ...run(40, SILENCE)], {
      vad: { preSpeechPadDuration: 1, minSpeechDuration: 0.032 },
      limit: { maxSegmentSamples: 16000 },
    });
    await h.feed(83);
    h.core.drain();
    await h.core.idle();
    const segs = h.segments();
    expect(segs.length).toBeGreaterThanOrEqual(1);
    for (const s of segs) expect(s.audio.length).toBeLessThanOrEqual(16000);
  });
});

describe('TurnDetectorCore — a release names its press', () => {
  it('begin(1), cancel(1), begin(2), audio, drain(1): the late release of press 1 ends nothing; press 2 goes on and ends at its own release', async () => {
    const m = manual();
    m.core.begin(1);
    await m.push(FRAME * 2);
    m.core.cancel(1);
    m.core.begin(2);
    await m.push(FRAME * 3);
    m.core.drain(1);
    await m.settle();
    expect(m.segments()).toEqual([]);
    await m.push(FRAME * 2);
    m.core.drain(2);
    await m.settle();
    const segs = m.segments();
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ press: 2, endedBy: 'release' });
    expect(segs[0].end - segs[0].start).toBe(FRAME * 5);
  });

  it('a release that names the open press, or none, ends it', async () => {
    const m = manual();
    m.core.begin(1);
    await m.push(FRAME * 2);
    m.core.drain(1);
    m.core.begin(2);
    await m.push(FRAME * 2);
    m.core.drain();
    await m.settle();
    expect(m.segments().map((s) => s.press)).toEqual([1, 2]);
  });
});
