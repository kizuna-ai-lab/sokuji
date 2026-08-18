/** SPIKE THROWAWAY — fast sanity checks before running the full sweep. */
import { describe, it, expect } from 'vitest';
import { EchoDetector, EnvelopeTracker } from '../echoDetector';
import { buildScene, SAMPLE_RATE } from './signalSim';

const say = (...a: unknown[]) => process.stdout.write(a.map(String).join(' ') + '\n');

function feed(detector: EchoDetector, mic: Float32Array, ref: Float32Array) {
  const chunk = Math.round(SAMPLE_RATE * 0.02);
  const perTick = Math.round(250 / 20);
  let sinceTick = 0;
  let best = { rho: -2, lagMs: 0 };
  let detected = false;
  for (let off = 0; off < mic.length; off += chunk) {
    const end = Math.min(mic.length, off + chunk);
    detector.pushMic(mic.subarray(off, end));
    detector.pushReference('ref', ref.subarray(off, end));
    if (++sinceTick >= perTick) {
      sinceTick = 0;
      const v = detector.tick();
      if (v.rho > best.rho) best = { rho: v.rho, lagMs: v.lagMs };
      if (v.detected) detected = true;
    }
  }
  return { best, detected };
}

function makeDetector() {
  const d = new EchoDetector({ sampleRate: SAMPLE_RATE, maxLagMs: 600, minLagMs: 20 });
  d.addReference('ref');
  return d;
}

describe('spike smoke', () => {
  it('envelope tracker emits frames at the expected rate and tracks level', () => {
    const t = new EnvelopeTracker(240, 100, -60); // 10ms frames at 24k
    const loud = new Float32Array(2400).fill(0.5);
    t.push(loud);
    expect(t.frameCount).toBe(10);
    const out = new Float32Array(10);
    expect(t.copyLast(10, out)).toBe(true);
    // 0.5 amplitude constant → RMS 0.5 → about -6 dB.
    expect(out[0]).toBeGreaterThan(-7);
    expect(out[0]).toBeLessThan(-5);
  });

  it('carries a partial frame across pushes rather than dropping it', () => {
    const t = new EnvelopeTracker(240, 100, -60);
    t.push(new Float32Array(100).fill(0.1));
    expect(t.frameCount).toBe(0);
    t.push(new Float32Array(140).fill(0.1));
    expect(t.frameCount).toBe(1);
  });

  it('detects a loud, short-delay echo', () => {
    const scene = buildScene('echo_only', {
      durationSec: 20,
      seed: 1,
      alpha: 0.4,
      delaySec: 0.08,
      rt60: 0.3,
      noiseRms: 0.002,
    });
    const r = feed(makeDetector(), scene.mic, scene.reference);
    say('echo_only  peak rho=', r.best.rho.toFixed(3), 'lagMs=', r.best.lagMs, 'detected=', r.detected);
    expect(r.detected).toBe(true);
    // The recovered lag should land near the 80 ms ground truth.
    expect(Math.abs(r.best.lagMs - 80)).toBeLessThanOrEqual(60);
  });

  it('stays quiet on headphone turn-taking', () => {
    const scene = buildScene('headphones_turn_taking', {
      durationSec: 20,
      seed: 3,
      alpha: 0,
      delaySec: 0,
      rt60: 0.3,
      noiseRms: 0.002,
    });
    const r = feed(makeDetector(), scene.mic, scene.reference);
    say('turn_taking  peak rho=', r.best.rho.toFixed(3), 'lagMs=', r.best.lagMs, 'detected=', r.detected);
    expect(r.detected).toBe(false);
  });
}, 120_000);
