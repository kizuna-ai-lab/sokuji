import { describe, it, expect } from 'vitest';
import { EchoMonitor, type EchoNoticeState } from './EchoMonitor';
import { SAMPLE_RATE, delay as delaySignal, makeRng, layoutUtterances, renderSpeech, addNoise, buildScene } from './echoSim';

const CHUNK = Math.round(SAMPLE_RATE * 0.02); // 20 ms
const CHUNKS_PER_TICK = Math.round(250 / 20);

/**
 * Drive a monitor with synchronized streams, calling tickOnce() at the 250 ms
 * cadence production uses. `tts` is drip-fed through readPlayedTts the way the
 * player ring tap will deliver it: whatever accumulated since the last tick.
 */
function drive(streams: {
  tts?: Float32Array;
  mic?: Float32Array;
  participant?: Float32Array;
  seconds: number;
}): { states: (EchoNoticeState | null)[]; final: EchoNoticeState | null } {
  const states: (EchoNoticeState | null)[] = [];
  let ttsCursor = 0;
  let pending = 0;

  const monitor = new EchoMonitor({
    readPlayedTts: () => {
      if (!streams.tts) return new Float32Array(0);
      const take = Math.min(pending, streams.tts.length - ttsCursor);
      const out = streams.tts.subarray(ttsCursor, ttsCursor + take);
      ttsCursor += take;
      pending = 0;
      return new Float32Array(out);
    },
    onChange: s => states.push(s),
  });

  const total = Math.round(streams.seconds * SAMPLE_RATE);
  let sinceTick = 0;
  for (let off = 0; off < total; off += CHUNK) {
    const end = Math.min(total, off + CHUNK);
    pending += end - off;
    if (streams.mic) monitor.pushMic(streams.mic.subarray(off, Math.min(end, streams.mic.length)));
    if (streams.participant) {
      monitor.pushParticipant(streams.participant.subarray(off, Math.min(end, streams.participant.length)));
    }
    if (++sinceTick >= CHUNKS_PER_TICK) {
      sinceTick = 0;
      monitor.tickOnce();
    }
  }
  return { states, final: states.length ? states[states.length - 1] : null };
}

function speech(seed: number, seconds: number, level = 0.25): Float32Array {
  const rng = makeRng(seed);
  const utts = layoutUtterances(seconds, rng, { speechRange: [1.2, 3.0], pauseRange: [0.5, 1.5] });
  return renderSpeech(utts, seconds, rng, { f0: 110, level });
}

describe('EchoMonitor cause attribution', () => {
  it('reports tts-echo when the mic hears delayed TTS', () => {
    const seconds = 60;
    const tts = speech(1, seconds);
    const rng = makeRng(2);
    const mic = addNoise(delaySignal(tts, 0.12), 0.002, rng);
    // Scale the echo down like a real acoustic path.
    for (let i = 0; i < mic.length; i++) mic[i] *= 0.4;

    const r = drive({ tts, mic, seconds });
    expect(r.final?.cause).toBe('tts-echo');
  });

  it('reports meeting-echo when the mic hears the participant stream, not TTS', () => {
    const seconds = 60;
    const participant = speech(3, seconds);
    const rng = makeRng(4);
    const mic = addNoise(delaySignal(participant, 0.15), 0.002, rng);
    for (let i = 0; i < mic.length; i++) mic[i] *= 0.4;

    const r = drive({ participant, mic, seconds });
    expect(r.final?.cause).toBe('meeting-echo');
  });

  it('reports self-capture when the participant stream contains our TTS at small lag', () => {
    const seconds = 60;
    const tts = speech(5, seconds);
    const rng = makeRng(6);
    const participant = addNoise(delaySignal(tts, 0.08), 0.001, rng);

    const r = drive({ tts, participant, seconds });
    expect(r.final?.cause).toBe('self-capture');
  });

  it('reports far-end-echo when our TTS returns in the participant stream after seconds', () => {
    const seconds = 60;
    const tts = speech(7, seconds);
    const rng = makeRng(8);
    const participant = addNoise(delaySignal(tts, 1.5), 0.001, rng);
    for (let i = 0; i < participant.length; i++) participant[i] *= 0.6;

    const r = drive({ tts, participant, seconds });
    expect(r.final?.cause).toBe('far-end-echo');
  });

  it('reports routing-loop, outranking tts-echo, when the mic is an electrical copy', () => {
    const seconds = 60;
    const tts = speech(9, seconds);
    const mic = delaySignal(tts, 0.005); // one quantum of pipe latency, no noise

    const r = drive({ tts, mic, seconds });
    expect(r.final?.cause).toBe('routing-loop');
  });

  it('stays clear on ordinary headphone turn-taking', () => {
    const seconds = 60;
    const scene = buildScene('headphones_turn_taking', {
      durationSec: seconds, seed: 11, alpha: 0, delaySec: 0, rt60: 0.3, noiseRms: 0.002, drrDb: 12,
    });
    const r = drive({ tts: scene.reference, mic: scene.mic, seconds });
    expect(r.states.length).toBe(0);
  });

  it('emits null when a detected echo goes away', () => {
    const seconds = 90;
    const tts = speech(13, seconds);
    // Echo path exists for the first 45 s, then the user puts headphones on.
    const rng = makeRng(14);
    const mic = addNoise(delaySignal(tts, 0.12), 0.002, rng);
    const cutoff = Math.round(45 * SAMPLE_RATE);
    for (let i = 0; i < mic.length; i++) mic[i] = i < cutoff ? mic[i] * 0.4 : 0;

    const r = drive({ tts, mic, seconds });
    expect(r.states[0]?.cause).toBe('tts-echo');
    expect(r.final).toBe(null);
  });
});

describe('EchoMonitor lifecycle', () => {
  it('stop() resets state and reports clear if a notice was active', () => {
    const states: (EchoNoticeState | null)[] = [];
    const monitor = new EchoMonitor({
      readPlayedTts: () => new Float32Array(0),
      onChange: s => states.push(s),
    });
    monitor.start();
    expect(monitor.running).toBe(true);
    monitor.stop();
    expect(monitor.running).toBe(false);
    // No notice was active, so no spurious clear event.
    expect(states.length).toBe(0);
  });
});
