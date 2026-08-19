import { describe, it, expect } from 'vitest';
import {
  EchoDetector,
  EnvelopeTracker,
  initialDecisionState,
  stepDecision,
  type DecisionParams,
} from './echoDetector';
import { buildScene, SAMPLE_RATE, delay as delaySignal, makeRng, layoutUtterances, renderSpeech } from './echoSim';

/** Feed PCM in ~20 ms chunks, ticking every 250 ms; collect verdicts. */
function run(
  detector: EchoDetector,
  streams: Array<{ push: (chunk: Float32Array) => void; pcm: Float32Array }>
) {
  const chunk = Math.round(SAMPLE_RATE * 0.02);
  const perTick = Math.round(250 / 20);
  const length = Math.min(...streams.map(s => s.pcm.length));
  let sinceTick = 0;
  let best = { rho: -2, lagMs: 0, cause: null as string | null };
  let detected = false;
  for (let off = 0; off < length; off += chunk) {
    const end = Math.min(length, off + chunk);
    for (const s of streams) s.push(s.pcm.subarray(off, end));
    if (++sinceTick >= perTick) {
      sinceTick = 0;
      const v = detector.tick();
      if (v.detected) {
        detected = true;
        best = { rho: v.rho, lagMs: v.lagMs, cause: v.cause };
      }
    }
  }
  return { detected, best };
}

describe('EnvelopeTracker', () => {
  it('emits frames at the configured rate and carries partial frames across pushes', () => {
    const t = new EnvelopeTracker(240, 100, -60);
    t.push(new Float32Array(100).fill(0.1));
    expect(t.frameCount).toBe(0);
    t.push(new Float32Array(140).fill(0.1));
    expect(t.frameCount).toBe(1);
  });

  it('treats Int16 input identically to equivalent Float32 input', () => {
    const f = new EnvelopeTracker(240, 100, -60);
    const i = new EnvelopeTracker(240, 100, -60);
    const float = new Float32Array(2400);
    const int = new Int16Array(2400);
    const rng = makeRng(7);
    for (let n = 0; n < 2400; n++) {
      const v = (rng() * 2 - 1) * 0.5;
      float[n] = v;
      int[n] = Math.round(v * 32768);
    }
    f.push(float);
    i.push(int);
    const fo = new Float32Array(10);
    const io = new Float32Array(10);
    expect(f.copyLast(10, fo)).toBe(true);
    expect(i.copyLast(10, io)).toBe(true);
    for (let n = 0; n < 10; n++) {
      expect(Math.abs(fo[n] - io[n])).toBeLessThan(0.01); // dB
    }
  });
});

describe('EchoDetector — single reference (swept defaults)', () => {
  it('detects a loud short-delay echo and recovers the lag', () => {
    const scene = buildScene('echo_only', {
      durationSec: 60, seed: 1, alpha: 0.4, delaySec: 0.08, rt60: 0.3, noiseRms: 0.002, drrDb: 12,
    });
    const d = new EchoDetector({ sampleRate: SAMPLE_RATE });
    d.addReference('tts');
    const r = run(d, [
      { push: c => d.pushMic(c), pcm: scene.mic },
      { push: c => d.pushReference('tts', c), pcm: scene.reference },
    ]);
    expect(r.detected).toBe(true);
    expect(r.best.cause).toBe('tts');
    expect(Math.abs(r.best.lagMs - 80)).toBeLessThanOrEqual(60);
  });

  it('stays quiet on headphone turn-taking', () => {
    const scene = buildScene('headphones_turn_taking', {
      durationSec: 60, seed: 3, alpha: 0, delaySec: 0, rt60: 0.3, noiseRms: 0.002, drrDb: 12,
    });
    const d = new EchoDetector({ sampleRate: SAMPLE_RATE });
    d.addReference('tts');
    const r = run(d, [
      { push: c => d.pushMic(c), pcm: scene.mic },
      { push: c => d.pushReference('tts', c), pcm: scene.reference },
    ]);
    expect(r.detected).toBe(false);
  });
});

describe('EchoDetector — per-reference lag bands', () => {
  it('attributes a seconds-scale return to the far-band reference, not the near-band one', () => {
    // Same underlying content registered twice with different bands: the
    // network-return scenario (our TTS coming back ~1.5 s later).
    const rng = makeRng(11);
    const utts = layoutUtterances(60, rng, { speechRange: [1.2, 3.0], pauseRange: [0.5, 1.5] });
    const tts = renderSpeech(utts, 60, rng, { f0: 110, level: 0.25 });
    const mic = delaySignal(tts, 1.5);

    const d = new EchoDetector({ sampleRate: SAMPLE_RATE });
    d.addReference('tts-near', { minLagMs: 20, maxLagMs: 600, decoyLagsMs: [2000, 3000, 4000, 5000] });
    d.addReference('tts-far', { minLagMs: 600, maxLagMs: 5000, decoyLagsMs: [8000, 10000, 12000, 15000] });

    const r = run(d, [
      { push: c => d.pushMic(c), pcm: mic },
      { push: c => { d.pushReference('tts-near', c); d.pushReference('tts-far', c); }, pcm: tts },
    ]);
    expect(r.detected).toBe(true);
    expect(r.best.cause).toBe('tts-far');
    expect(Math.abs(r.best.lagMs - 1500)).toBeLessThanOrEqual(100);
  });

  it('detects a near-zero-lag electrical loop when minLagMs is 0', () => {
    // Routing loop: the "mic" IS the playback, one 10 ms frame late.
    const rng = makeRng(13);
    const utts = layoutUtterances(60, rng, { speechRange: [1.2, 3.0], pauseRange: [0.5, 1.5] });
    const tts = renderSpeech(utts, 60, rng, { f0: 110, level: 0.25 });
    const mic = delaySignal(tts, 0.01);

    const d = new EchoDetector({ sampleRate: SAMPLE_RATE, rhoThreshold: 0.9 });
    d.addReference('tts', { minLagMs: 0, maxLagMs: 40 });
    const r = run(d, [
      { push: c => d.pushMic(c), pcm: mic },
      { push: c => d.pushReference('tts', c), pcm: tts },
    ]);
    expect(r.detected).toBe(true);
    expect(r.best.lagMs).toBeLessThanOrEqual(40);
  });

  it('accepts Int16 PCM end to end', () => {
    const scene = buildScene('echo_only', {
      durationSec: 60, seed: 5, alpha: 0.4, delaySec: 0.08, rt60: 0.3, noiseRms: 0.002, drrDb: 12,
    });
    const toInt16 = (f: Float32Array) => {
      const out = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) {
        out[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32768)));
      }
      return out;
    };
    const micI = toInt16(scene.mic);
    const refI = toInt16(scene.reference);

    const d = new EchoDetector({ sampleRate: SAMPLE_RATE });
    d.addReference('tts');
    const chunk = Math.round(SAMPLE_RATE * 0.02);
    const perTick = Math.round(250 / 20);
    let sinceTick = 0;
    let detected = false;
    for (let off = 0; off < micI.length; off += chunk) {
      const end = Math.min(micI.length, off + chunk);
      d.pushMic(micI.subarray(off, end));
      d.pushReference('tts', refI.subarray(off, end));
      if (++sinceTick >= perTick) {
        sinceTick = 0;
        if (d.tick().detected) detected = true;
      }
    }
    expect(detected).toBe(true);
  });
});

describe('stepDecision', () => {
  const P: DecisionParams = {
    rhoThreshold: 0.5, contrastThreshold: 0.4, historyTicks: 80, minVotes: 3,
    lagBinFrames: 4, clearAfterTicks: 4,
  };
  const strong = (lagFrames: number) => ({ winner: 'tts', rho: 0.9, contrast: 0.8, lagFrames });
  const weak = { winner: 'tts', rho: 0.2, contrast: 0.0, lagFrames: 10 };

  it('detects once enough votes land in one lag bin, and survives interruptions', () => {
    let s = initialDecisionState();
    s = stepDecision(s, strong(10), P);
    s = stepDecision(s, weak, P); // user talks over the echo — vote missed
    s = stepDecision(s, strong(11), P); // same bin (tolerance 4 frames)
    expect(s.detected).toBe(false);
    s = stepDecision(s, strong(9), P);
    expect(s.detected).toBe(true);
  });

  it('does not detect when strong peaks scatter across lag bins', () => {
    let s = initialDecisionState();
    for (const lag of [5, 30, 55, 20, 48, 8, 37]) {
      s = stepDecision(s, strong(lag), P);
    }
    expect(s.detected).toBe(false);
  });

  it('clears after sustained silence from the references', () => {
    let s = initialDecisionState();
    for (const lag of [10, 10, 10]) s = stepDecision(s, strong(lag), P);
    expect(s.detected).toBe(true);
    for (let i = 0; i < 4; i++) s = stepDecision(s, { winner: null, rho: 0, contrast: 0, lagFrames: 0 }, P);
    expect(s.detected).toBe(false);
  });
});
