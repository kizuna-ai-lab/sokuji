/**
 * OFFLINE THRESHOLD SWEEP — skipped in CI (runs ~60s); remove `.skip` to re-run
 * when tuning the detector's thresholds. This is the evidence base for the
 * defaults in echoDetector.ts.
 *
 * Question: is there an operating point at which envelope correlation catches
 * real acoustic echo without firing on an ordinary meeting?
 *
 * Two earlier sweeps shaped this one:
 *  - peak-to-sidelobe ratio is not discriminative here, because the speech
 *    envelope's autocorrelation is wider than the whole lag search range;
 *  - simply lengthening the correlation window kills false positives but also
 *    kills detection, because it demands the user stay silent for the whole
 *    window. Hence the vote histogram: short windows, agreement over time.
 *
 * Run: npx vitest run src/lib/modern-audio/__spike__/echoDetector.spike.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  EchoDetector,
  initialDecisionState,
  stepDecision,
  type DecisionParams,
  type Observation,
} from './echoDetector';
import { buildScene, SAMPLE_RATE, type Scene, type SceneKind, type SceneParams } from './echoSim';

const say = (...a: unknown[]) => process.stdout.write(a.map(String).join(' ') + '\n');

const FRAME_MS = 10;
const MAX_LAG_MS = 600;
const TICK_MS = 250;
const CHUNK_MS = 20;
const DURATION = 90;
const WINDOWS = [2000];
const HISTORIES = [40, 80]; // 10 s / 20 s of voting history

function recordScene(mic: Float32Array, reference: Float32Array, windowMs: number): Observation[] {
  const detector = new EchoDetector({
    sampleRate: SAMPLE_RATE,
    frameMs: FRAME_MS,
    windowMs,
    maxLagMs: MAX_LAG_MS,
    minLagMs: 20,
  });
  detector.addReference('ref');

  const chunk = Math.round((SAMPLE_RATE * CHUNK_MS) / 1000);
  const chunksPerTick = Math.round(TICK_MS / CHUNK_MS);
  const warmupMs = windowMs + MAX_LAG_MS;

  const out: Observation[] = [];
  let elapsedMs = 0;
  let sinceTick = 0;

  for (let off = 0; off < mic.length; off += chunk) {
    const end = Math.min(mic.length, off + chunk);
    detector.pushMic(mic.subarray(off, end));
    detector.pushReference('ref', reference.subarray(off, end));
    elapsedMs += CHUNK_MS;
    if (++sinceTick >= chunksPerTick) {
      sinceTick = 0;
      if (elapsedMs >= warmupMs) out.push(detector.observe());
    }
  }
  return out;
}

function replay(series: Observation[], p: DecisionParams): { hit: boolean; ticks: number } {
  let state = initialDecisionState();
  for (let i = 0; i < series.length; i++) {
    state = stepDecision(state, series[i], p);
    if (state.detected) return { hit: true, ticks: i + 1 };
  }
  return { hit: false, ticks: -1 };
}

function params(rho: number, minVotes: number, contrast: number, historyTicks: number): DecisionParams {
  return {
    rhoThreshold: rho,
    contrastThreshold: contrast,
    historyTicks,
    minVotes,
    lagBinFrames: 4, // 40 ms
    // Long enough that a detection survives the user talking through it.
    clearAfterTicks: 120,
  };
}

interface Built { kind: SceneKind; params: SceneParams; scene: Scene }
interface Case { kind: SceneKind; params: SceneParams; series: Observation[] }

const pct = (n: number, d: number) => (d === 0 ? '   -' : `${((100 * n) / d).toFixed(0).padStart(3)}%`);
const rate = (cases: Case[], p: DecisionParams) => cases.filter(c => replay(c.series, p).hit).length;

const NEG_KINDS: SceneKind[] = [
  'headphones_listening',
  'headphones_turn_taking',
  'headphones_overlap',
  'readback',
  'near_only',
];
const ECHO_KINDS: SceneKind[] = ['echo_listening', 'echo_only', 'echo_double_talk'];

describe.only('echo detection threshold sweep', () => {
  it('sweeps window x rho x votes across echo and non-echo scenes', () => {
    const alphas = [0.1, 0.2, 0.4];
    const delays = [0.03, 0.15, 0.3];

    const echoBuilt: Built[] = [];
    for (const alpha of alphas)
      for (const delaySec of delays)
        for (const rt60 of [0.3, 0.7])
          for (const seed of [1, 2, 3])
            for (const kind of ECHO_KINDS) {
              const p: SceneParams = {
                durationSec: DURATION, seed, alpha, delaySec, rt60, noiseRms: 0.004, drrDb: 12,
              };
              echoBuilt.push({ kind, params: p, scene: buildScene(kind, p) });
            }

    const negBuilt: Built[] = [];
    for (const kind of NEG_KINDS)
      for (const seed of Array.from({ length: 20 }, (_, i) => i + 1)) {
        const p: SceneParams = {
          durationSec: DURATION, seed, alpha: 0, delaySec: 0, rt60: 0.3, noiseRms: 0.004, drrDb: 12,
        };
        negBuilt.push({ kind, params: p, scene: buildScene(kind, p) });
      }

    const L: string[] = [];
    L.push('');
    L.push(`echo scenes: ${echoBuilt.length}   non-echo scenes: ${negBuilt.length}   ${DURATION}s each`);
    L.push(`tick ${TICK_MS}ms, lag bin 40ms, decoy lags 2-5s`);
    L.push('cells: TPR / worst-case FPR over the four non-echo scenes');
    L.push('');

    const VOTES = [8, 10, 12, 14, 16];
    const CONTRASTS = [0.25, 0.3, 0.35, 0.4];
    const store = new Map<number, { echo: Case[]; neg: Case[] }>();

    for (const windowMs of WINDOWS) {
      const echo: Case[] = echoBuilt.map(b => ({
        kind: b.kind, params: b.params, series: recordScene(b.scene.mic, b.scene.reference, windowMs),
      }));
      const neg: Case[] = negBuilt.map(b => ({
        kind: b.kind, params: b.params, series: recordScene(b.scene.mic, b.scene.reference, windowMs),
      }));
      store.set(windowMs, { echo, neg });

      const q = (arr: number[], f: number) =>
        arr.length ? arr[Math.min(arr.length - 1, Math.floor(f * arr.length))] : NaN;
      L.push(`  window ${windowMs}ms — contrast distribution (per tick)`);
      for (const k of [...ECHO_KINDS, ...NEG_KINDS]) {
        const vals: number[] = [];
        for (const c of [...echo, ...neg]) {
          if (c.kind !== k) continue;
          for (const o of c.series) if (o.winner) vals.push(o.contrast);
        }
        vals.sort((a, b) => a - b);
        L.push(
          `    ${k.padEnd(24)} p50 ${q(vals, 0.5).toFixed(2).padStart(6)}  p90 ${q(vals, 0.9)
            .toFixed(2)
            .padStart(6)}  p99 ${q(vals, 0.99).toFixed(2).padStart(6)}`
        );
      }
      L.push('');

      for (const hist of HISTORIES) {
        L.push(`  history ${(hist * TICK_MS) / 1000}s — TPR / worst-case FPR   (rho>=0.5)`);
        L.push('    votes ' + CONTRASTS.map(c => `ctr${c.toFixed(2)}`.padStart(12)).join(''));
        for (const v of VOTES) {
          if (v > hist) continue;
          const cells = CONTRASTS.map(ct => {
            const p = params(0.5, v, ct, hist);
            const tpr = (100 * rate(echo, p)) / echo.length;
            const worst = Math.max(...NEG_KINDS.map(k => {
              const sub = neg.filter(c => c.kind === k);
              return sub.length ? (100 * rate(sub, p)) / sub.length : 0;
            }));
            return `${tpr.toFixed(0)}/${worst.toFixed(0)}`.padStart(12);
          });
          L.push(`    ${String(v).padStart(5)} ` + cells.join(''));
        }
        L.push('');
      }
    }

    // --- detail at a promising operating point -----------------------------
    const PICK_WINDOW = 2000;
    const PICK_HISTORY = 80;
    const PICK = params(0.5, 16, 0.4, PICK_HISTORY);
    const { echo, neg } = store.get(PICK_WINDOW)!;
    L.push(
      `  detail — window ${PICK_WINDOW}ms, rho>=${PICK.rhoThreshold}, contrast>=${PICK.contrastThreshold}, votes>=${PICK.minVotes}/${PICK_HISTORY}:`
    );
    for (const k of ECHO_KINDS) {
      const sub = echo.filter(c => c.kind === k);
      L.push(`    TPR ${k.padEnd(24)} ${pct(rate(sub, PICK), sub.length)}`);
    }
    for (const k of NEG_KINDS) {
      const sub = neg.filter(c => c.kind === k);
      L.push(`    FPR ${k.padEnd(24)} ${pct(rate(sub, PICK), sub.length)}`);
    }
    L.push('    TPR by attenuation: ' + alphas.map(a => {
      const sub = echo.filter(c => c.params.alpha === a);
      const listen = sub.filter(c => c.kind === 'echo_listening');
      const dt = sub.filter(c => c.kind === 'echo_double_talk');
      return `a=${a} [listening ${pct(rate(listen, PICK), listen.length)} dbltalk ${pct(rate(dt, PICK), dt.length)}]`;
    }).join('  '));
    L.push('    TPR by delay:       ' + delays.map(d => {
      const sub = echo.filter(c => c.params.delaySec === d);
      return `${d * 1000}ms ${pct(rate(sub, PICK), sub.length)}`;
    }).join('  '));

    const ticks = echo.map(c => replay(c.series, PICK)).filter(r => r.hit).map(r => r.ticks).sort((a, b) => a - b);
    if (ticks.length) {
      const at = (q2: number) => ticks[Math.min(ticks.length - 1, Math.floor(q2 * ticks.length))];
      const warm = (PICK_WINDOW + 5000) / 1000;
      L.push(`    time-to-detect (incl. ${warm}s warm-up): median ${(warm + (at(0.5) * TICK_MS) / 1000).toFixed(1)}s  p90 ${(warm + (at(0.9) * TICK_MS) / 1000).toFixed(1)}s`);
    }

    L.push('');
    say(L.join('\n'));
    expect(echoBuilt.length).toBeGreaterThan(0);
  }, 1_800_000);
});
