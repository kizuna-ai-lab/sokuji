/** SPIKE THROWAWAY — cost of one detection tick. */
import { describe, it } from 'vitest';
import { EchoDetector } from '../echoDetector';
import { buildScene, SAMPLE_RATE } from './signalSim';

const say = (...a: unknown[]) => process.stdout.write(a.map(String).join(' ') + '\n');

describe('spike bench', () => {
  it('measures per-tick cost with one and three references', () => {
    const scene = buildScene('echo_listening', {
      durationSec: 30,
      seed: 1,
      alpha: 0.3,
      delaySec: 0.1,
      rt60: 0.4,
      noiseRms: 0.004,
      drrDb: 12,
    });

    for (const refCount of [1, 3]) {
      const d = new EchoDetector({ sampleRate: SAMPLE_RATE, windowMs: 2000, maxLagMs: 600, minLagMs: 20 });
      for (let i = 0; i < refCount; i++) d.addReference(`ref${i}`);

      const chunk = Math.round(SAMPLE_RATE * 0.02);
      for (let off = 0; off < scene.mic.length; off += chunk) {
        const end = Math.min(scene.mic.length, off + chunk);
        d.pushMic(scene.mic.subarray(off, end));
        for (let i = 0; i < refCount; i++) d.pushReference(`ref${i}`, scene.reference.subarray(off, end));
      }

      const N = 200;
      const t0 = performance.now();
      for (let i = 0; i < N; i++) d.tick();
      const perTick = (performance.now() - t0) / N;
      // Detection ticks run at 4 Hz.
      say(`refs=${refCount}  per-tick ${perTick.toFixed(3)}ms  duty at 4Hz ${((perTick * 4) / 10).toFixed(4)}% of one core`);
    }
  }, 120_000);
});
