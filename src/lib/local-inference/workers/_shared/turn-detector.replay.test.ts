/**
 * The deterministic half of the before/after (spec §9): the segment boundaries today's worker VAD cut on the
 * recorded Japanese sentences, against the detector's, frame for frame. Both paths replay the same Silero
 * probabilities (recorded by scripts/dev/turn-fixtures/silero-probs.mjs) with the model reset a no-op, so what is
 * compared is the segmenting logic on real speech, not Silero.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VadWebConfig } from '../../types';
import { VAD_FRAME_SAMPLES, type SegmentLimit } from './max-speech-frames';
import fixture from './__fixtures__/ja-sentences.silero.json';
import { legacyVadLoop, type LegacySegment } from './legacy-vad-loop.testing';
import { DetectorLeg } from './turn-detector-leg';
import type { DetectorNotice, DetectorOutput, DetectorSegment } from './turn-detector-protocol';
import { openTurnLink } from './turn-gate';
import type { TurnPredictAnswer, TurnPredictRequest } from './turn-protocol';

const FRAME = VAD_FRAME_SAMPLES;
const ASSETS = path.resolve(__dirname, '../../../../../scripts/dev/wire-probe/assets/ja');
/** The Whisper worker's limit (C4). */
const WHISPER: SegmentLimit = { maxSegmentSamples: 29 * 16000 };

/** The defaults the settings ship (§7). */
const VAD: VadWebConfig = {
  threshold: 0.3,
  minSilenceDuration: 1.4,
  minSpeechDuration: 0.4,
  preSpeechPadDuration: 0.8,
  maxSpeechDuration: 30,
};

/** A 16-bit mono 16 kHz WAV's samples. */
function wav(name: string): Int16Array {
  const buf = fs.readFileSync(path.join(ASSETS, `${name}.wav`));
  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'data') {
      const n = Math.min(size, buf.length - at - 8) >> 1;
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(at + 8 + 2 * i);
      return out;
    }
    at += 8 + size + (size & 1);
  }
  throw new Error(`${name}: no data chunk`);
}

/** 16 kHz to 24 kHz, linear. */
function upsample24k(pcm: Int16Array): Int16Array {
  const out = new Int16Array(Math.floor(pcm.length * 1.5));
  for (let i = 0; i < out.length; i++) {
    const src = i / 1.5;
    const lo = Math.floor(src);
    const hi = Math.min(lo + 1, pcm.length - 1);
    out[i] = Math.round(pcm[lo] + (pcm[hi] - pcm[lo]) * (src - lo));
  }
  return out;
}

/** The sentences at 24 kHz, with their pauses or back to back, in the 2400-sample chunks the app feeds. */
function chunks(pauses: boolean): Int16Array[] {
  const parts: Int16Array[] = [];
  fixture.clips.forEach((name, i) => {
    parts.push(wav(name));
    if (pauses) parts.push(new Int16Array(Math.round((fixture.pausesMs[i] / 1000) * 16000)));
  });
  let all = upsample24k(Int16Array.from(parts.flatMap((p) => Array.from(p))));
  // Back to back, the stream ends in speech and a drain closes it, which is where the two differ by design: the
  // detector delivers the last partial frame (fewer than 512 samples at 16 kHz) on a drain (spec C2, §3), and the
  // worker's flush never saw it. So that input ends on a whole frame, 768 samples at 24 kHz, for both paths.
  if (!pauses) all = all.subarray(0, all.length - (all.length % (FRAME * 1.5)));
  const out: Int16Array[] = [];
  for (let at = 0; at < all.length; at += 2400) out.push(all.subarray(at, Math.min(at + 2400, all.length)));
  return out;
}

/** A Smart Turn port that answers every request at once with `probability`. */
class AnsweringPort {
  onmessage: ((event: { data: TurnPredictAnswer }) => void) | null = null;
  requests = 0;
  constructor(private readonly probability: number) {}
  postMessage(message: TurnPredictRequest): void {
    this.requests++;
    this.onmessage?.({ data: { id: message.id, probability: this.probability } });
  }
  close(): void {}
}

interface Cut {
  start: number;
  end: number;
  endedBy: string;
  smartTurnProbability?: number;
  audio: Float32Array;
}

interface Scenario {
  frames: number[];
  chunks: Int16Array[];
  vad: VadWebConfig;
  /** Smart Turn answers every request with this probability. */
  smart?: number;
}

/** What the worker VAD cut: `feedAudio` on every chunk, then `handleFlush`. */
async function worker(s: Scenario): Promise<Cut[]> {
  let next = 0;
  const port = s.smart !== undefined ? new AnsweringPort(s.smart) : undefined;
  const loop = legacyVadLoop({
    vadConfig: s.smart !== undefined ? { ...s.vad, smartTurn: { checkAfter: 0.3, threshold: 0.5 } } : s.vad,
    limit: WHISPER,
    infer: () => s.frames[next++] ?? 0,
    smartPort: port as unknown as MessagePort | undefined,
  });
  for (const chunk of s.chunks) await loop.feed(chunk);
  loop.flush();
  return loop.segments.map(cut);
}

function cut(seg: LegacySegment): Cut {
  // The rescue window (Smart) ends at the frame before the one in hand; every other cut ends at the frame just processed.
  const end = seg.end.endedBy === 'kept' ? seg.fedAt - FRAME : seg.fedAt;
  return {
    start: seg.end.endedBy === 'kept' ? end - seg.audio.length : seg.startSample,
    end,
    endedBy: seg.end.endedBy,
    ...(seg.end.smartTurnProbability !== undefined ? { smartTurnProbability: seg.end.smartTurnProbability } : {}),
    audio: seg.audio,
  };
}

/** What the detector cut: the same chunks, pushed in order, then a drain. */
async function detector(s: Scenario): Promise<{ cuts: Cut[]; notices: DetectorNotice[] }> {
  let next = 0;
  const outputs: DetectorOutput[] = [];
  const notices: DetectorNotice[] = [];
  const port = s.smart !== undefined ? new AnsweringPort(s.smart) : undefined;
  const leg: DetectorLeg = new DetectorLeg({
    core: {
      turns: 'auto',
      vad: s.smart !== undefined ? { ...s.vad, smartTurn: { checkAfter: 0.3, threshold: 0.5 } } : s.vad,
      limit: WHISPER,
      infer: async () => s.frames[next++] ?? 0,
      resetModel: () => {},
      smart: port ? (processor) => openTurnLink(port as unknown as MessagePort, { smartTurn: { checkAfter: 0.3, threshold: 0.5 } }, processor) : undefined,
    },
    post: (msg) => {
      outputs.push(msg);
      // The recognizer starts every segment as it arrives, so the decode queue stays empty.
      if (msg.type === 'segment') queueMicrotask(() => leg.taken({ type: 'taken', epoch: msg.epoch, seq: msg.seq }));
    },
    notify: (n) => notices.push(n),
  });
  // At most a second at a time, then wait: the leg fails when more than 2 s is unprocessed.
  let sincePaced = 0;
  for (const chunk of s.chunks) {
    leg.push(chunk);
    sincePaced += chunk.length;
    if (sincePaced >= 24000) {
      sincePaced = 0;
      await leg.core.idle();
    }
  }
  await leg.core.idle();
  leg.drain();
  await leg.core.idle();
  const cuts = outputs
    .filter((o): o is DetectorSegment => o.type === 'segment')
    .map((o) => ({
      start: o.start,
      end: o.end,
      endedBy: o.endedBy as string,
      ...(o.smartTurnProbability !== undefined ? { smartTurnProbability: o.smartTurnProbability } : {}),
      audio: o.audio,
    }));
  return { cuts, notices };
}

/** In frames, for reading a failure. */
const spans = (cuts: Cut[]) => cuts.map((c) => ({ start: c.start / FRAME, end: c.end / FRAME, endedBy: c.endedBy, ...(c.smartTurnProbability !== undefined ? { p: c.smartTurnProbability } : {}) }));

/** Where two runs of samples first differ, or null: toEqual over long float arrays is slow. */
function difference(a: Float32Array, b: Float32Array): string | null {
  if (a.length !== b.length) return `${a.length} samples, expected ${b.length}`;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return `sample ${i}: ${a[i]}, expected ${b[i]}`;
  return null;
}

const NORMAL: Scenario = { frames: fixture.frames, chunks: chunks(true), vad: VAD };

describe('the detector cuts the recorded Japanese sentences as the worker VAD did', () => {
  it('the fixture is the sentences and their pauses, frame for frame', () => {
    const samples = chunks(true).reduce((n, c) => n + c.length, 0);
    // 24 kHz in, 16 kHz out: whole frames only, as Silero saw them.
    expect(Math.floor((samples / 1.5) / FRAME)).toBe(fixture.frames.length);
  });

  it('Normal: the detector cuts the segments the Whisper worker cut — same start, end, audio and endedBy', async () => {
    const before = await worker(NORMAL);
    const after = await detector(NORMAL);
    expect(after.notices.filter((n) => n.type === 'failed')).toEqual([]);
    expect(before.length).toBeGreaterThanOrEqual(1);
    expect(spans(after.cuts)).toEqual(spans(before));
    after.cuts.forEach((c, i) => expect(difference(c.audio, before[i].audio)).toBeNull());
  });

  it('Smart answering 0.9 on every request: the same segments and the same Smart ends', async () => {
    const scenario: Scenario = { ...NORMAL, smart: 0.9 };
    const before = await worker(scenario);
    const after = await detector(scenario);
    expect(after.notices.filter((n) => n.type === 'failed')).toEqual([]);
    expect(before.some((c) => c.endedBy === 'smart')).toBe(true);
    expect(spans(after.cuts)).toEqual(spans(before));
    after.cuts.forEach((c, i) => expect(difference(c.audio, before[i].audio)).toBeNull());
  });

  it('Max speech 10 s over the sentences played without pauses: the same cuts, plus each post-cap tail the worker dropped and nothing else', async () => {
    const scenario: Scenario = { frames: fixture.framesNoPause, chunks: chunks(false), vad: { ...VAD, maxSpeechDuration: 10 } };
    const before = await worker(scenario);
    const after = await detector(scenario);
    expect(after.notices.filter((n) => n.type === 'failed')).toEqual([]);
    expect(before.some((c) => c.endedBy === 'cap')).toBe(true);
    // The worker dropped the tail after a cap that was shorter than minSpeech; the detector continues the turn and
    // emits it, starting exactly at the cut. Those are the only extras allowed, and with them removed the lists agree.
    const capEnds = new Set(after.cuts.filter((c) => c.endedBy === 'cap').map((c) => c.end));
    const extras = after.cuts.filter((c, i) => i > 0 && capEnds.has(c.start) && !before.some((b) => b.start === c.start && b.end === c.end && b.endedBy === c.endedBy));
    const rest = after.cuts.filter((c) => !extras.includes(c));
    expect(spans(rest)).toEqual(spans(before));
    rest.forEach((c, i) => expect(difference(c.audio, before[i].audio)).toBeNull());
  });

  it('Smart with a long Normal wait: the same segments, a kept segment ending one frame later (T6-2)', async () => {
    // Min speech 2 s makes a reply after a Smart end a misfire the gate keeps, which is the one place the two differ.
    const scenario: Scenario = { ...NORMAL, smart: 0.9, vad: { ...VAD, minSpeechDuration: 2 } };
    const before = await worker(scenario);
    const after = await detector(scenario);
    expect(after.notices.filter((n) => n.type === 'failed')).toEqual([]);
    expect(before.filter((c) => c.endedBy === 'kept').length).toBeGreaterThanOrEqual(1);
    expect(after.cuts).toHaveLength(before.length);
    after.cuts.forEach((c, i) => {
      const w = before[i];
      if (w.endedBy !== 'kept') {
        expect(spans([c])).toEqual(spans([w]));
        expect(difference(c.audio, w.audio)).toBeNull();
        return;
      }
      // Ruling T6-2 (Task 6 review): a kept segment spans start..ending frame, half-open, so it may end one frame
      // (512 samples) after the worker's rescue window, on a kept segment's end only.
      expect({ start: c.start, endedBy: c.endedBy }).toEqual({ start: w.start, endedBy: w.endedBy });
      expect(Math.abs(c.end - w.end)).toBeLessThanOrEqual(FRAME);
      expect(difference(c.audio.subarray(0, w.audio.length), w.audio)).toBeNull();
    });
  });
});
