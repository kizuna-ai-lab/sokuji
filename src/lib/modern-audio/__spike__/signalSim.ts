/**
 * SPIKE THROWAWAY — signal simulator for the echo-detection probe.
 *
 * Generates speech-like PCM and the acoustic paths that turn a reference signal
 * into microphone echo, so the detector can be swept over attenuation, delay,
 * reverberation and SNR without a room.
 *
 * The detector only ever sees per-10ms RMS, so effort here goes into the
 * *envelope* being realistic — phrase-length bursts, syllabic modulation, real
 * pauses — rather than into spectral fidelity of the carrier.
 */

export const SAMPLE_RATE = 24000;

/** Deterministic RNG so a sweep result can be reproduced exactly. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One contiguous stretch of speech, in seconds. */
export interface Utterance {
  start: number;
  end: number;
}

/**
 * Lay out alternating speech and pause intervals across `durationSec`.
 *
 * Durations are drawn uniformly from the given ranges; the result is the phrase
 * structure that dominates a speech envelope at the 2-second scale the detector
 * correlates over.
 */
export function layoutUtterances(
  durationSec: number,
  rng: () => number,
  opts: { speechRange: [number, number]; pauseRange: [number, number]; startAt?: number }
): Utterance[] {
  const out: Utterance[] = [];
  const [sLo, sHi] = opts.speechRange;
  const [pLo, pHi] = opts.pauseRange;
  let t = opts.startAt ?? 0;
  while (t < durationSec) {
    const dur = sLo + rng() * (sHi - sLo);
    const end = Math.min(durationSec, t + dur);
    if (end > t) out.push({ start: t, end });
    t = end + pLo + rng() * (pHi - pLo);
  }
  return out;
}

/** Speech intervals that fill the gaps of `other` — i.e. natural turn-taking. */
export function layoutReplies(
  other: Utterance[],
  durationSec: number,
  rng: () => number,
  opts: { gapRange: [number, number]; speechRange: [number, number] }
): Utterance[] {
  const out: Utterance[] = [];
  const [gLo, gHi] = opts.gapRange;
  const [sLo, sHi] = opts.speechRange;
  for (let i = 0; i < other.length; i++) {
    const replyStart = other[i].end + gLo + rng() * (gHi - gLo);
    const nextStart = i + 1 < other.length ? other[i + 1].start : durationSec;
    // Leave a beat before the other party resumes, so replies do not overlap.
    const latest = Math.min(durationSec, nextStart - 0.1);
    if (replyStart >= latest) continue;
    const dur = sLo + rng() * (sHi - sLo);
    out.push({ start: replyStart, end: Math.min(latest, replyStart + dur) });
  }
  return out;
}

/**
 * Render utterances into PCM.
 *
 * Carrier is a jittered harmonic stack plus fricative noise; amplitude follows a
 * syllabic modulation (3-7 Hz) inside each utterance, with raised-cosine onsets
 * and offsets so frame energy ramps the way speech does rather than clicking.
 */
export function renderSpeech(
  utterances: Utterance[],
  durationSec: number,
  rng: () => number,
  opts: { f0?: number; level?: number } = {}
): Float32Array {
  const n = Math.round(durationSec * SAMPLE_RATE);
  const out = new Float32Array(n);
  const f0 = opts.f0 ?? 90 + rng() * 90;
  const level = opts.level ?? 0.25;

  for (const u of utterances) {
    const from = Math.max(0, Math.round(u.start * SAMPLE_RATE));
    const to = Math.min(n, Math.round(u.end * SAMPLE_RATE));
    if (to <= from) continue;

    const len = to - from;
    // Each utterance gets its own syllable rate and phase.
    const sylHz = 3 + rng() * 4;
    const sylPhase = rng() * Math.PI * 2;
    const rampLen = Math.min(Math.round(0.03 * SAMPLE_RATE), Math.floor(len / 2));
    const f0Local = f0 * (0.9 + rng() * 0.2);

    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;

      // Syllabic amplitude modulation: never fully closes, matching how speech
      // energy dips between syllables rather than going silent.
      const syl = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * sylHz * t + sylPhase), 1.6);

      // Onset/offset ramp.
      let ramp = 1;
      if (i < rampLen) ramp = 0.5 - 0.5 * Math.cos((Math.PI * i) / rampLen);
      else if (i > len - rampLen) ramp = 0.5 - 0.5 * Math.cos((Math.PI * (len - i)) / rampLen);

      // Carrier: three harmonics plus noise, roughly a voiced/unvoiced mix.
      const ph = 2 * Math.PI * f0Local * t;
      const harm =
        Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.3 * Math.sin(3 * ph);
      const noise = rng() * 2 - 1;
      const carrier = 0.75 * harm * 0.5 + 0.25 * noise;

      out[from + i] += level * ramp * syl * carrier;
    }
  }
  return out;
}

/**
 * A room impulse response as a sparse set of early reflections.
 *
 * A dense RIR would be O(N·M) to convolve — at 24 kHz with an 0.8 s tail that is
 * ~10^10 multiply-adds per scene, which makes a parameter sweep impossible. The
 * dense tail also contributes almost nothing to what this probe measures: energy
 * beyond the early reflections is 40+ dB down and smears the 10 ms envelope only
 * marginally. Modelling the direct path plus ~60 discrete reflections keeps the
 * envelope smearing that degrades the correlation peak, at O(N·60).
 */
export interface SparseRir {
  delays: Int32Array;
  gains: Float32Array;
}

export function makeRir(rt60Sec: number, rng: () => number, drrDb = 10, taps = 60): SparseRir {
  const spanSamples = Math.max(1, Math.round(rt60Sec * SAMPLE_RATE));
  const delays = new Int32Array(taps);
  const gains = new Float32Array(taps);

  // Direct path. Without it the ground-truth lag would be ill-defined.
  delays[0] = 0;
  gains[0] = 1;

  // -60 dB across rt60.
  const decay = Math.log(1000) / spanSamples;
  for (let k = 1; k < taps; k++) {
    // Reflections cluster early and thin out, as in a real room.
    const frac = Math.pow(rng(), 1.7);
    const d = Math.max(1, Math.round(frac * spanSamples));
    delays[k] = d;
    gains[k] = (rng() * 2 - 1) * Math.exp(-decay * d);
  }

  // Scale the reverberant tail to hit the requested direct-to-reverberant ratio.
  // Without this the tail carries most of the energy and the direct path lands
  // near 0.4 — a cathedral, not a desk. A laptop speaker sits tens of
  // centimetres from its own microphone, which is near-field: the direct path
  // dominates by 10-20 dB, and that ratio is what decides whether the echo's
  // envelope survives intact enough to correlate.
  let tailEnergy = 0;
  for (let k = 1; k < taps; k++) tailEnergy += gains[k] * gains[k];
  if (tailEnergy > 0) {
    const wanted = Math.pow(10, -drrDb / 10); // tail energy relative to direct
    const scale = Math.sqrt(wanted / tailEnergy);
    for (let k = 1; k < taps; k++) gains[k] *= scale;
  }

  // Normalise total energy so alpha keeps meaning "echo level at the mic".
  let energy = 0;
  for (let k = 0; k < taps; k++) energy += gains[k] * gains[k];
  const norm = 1 / Math.sqrt(energy);
  for (let k = 0; k < taps; k++) gains[k] *= norm;

  return { delays, gains };
}

/** Convolve with a sparse impulse response, truncated to the input length. */
export function convolve(x: Float32Array, h: SparseRir): Float32Array {
  const out = new Float32Array(x.length);
  for (let k = 0; k < h.delays.length; k++) {
    const d = h.delays[k];
    const g = h.gains[k];
    if (g === 0 || d >= x.length) continue;
    const limit = x.length - d;
    for (let i = 0; i < limit; i++) {
      out[i + d] += x[i] * g;
    }
  }
  return out;
}

/** Shift `x` later in time by `delaySec`, zero-filling the head. */
export function delay(x: Float32Array, delaySec: number): Float32Array {
  const d = Math.round(delaySec * SAMPLE_RATE);
  const out = new Float32Array(x.length);
  if (d >= x.length) return out;
  out.set(x.subarray(0, x.length - d), d);
  return out;
}

export function addNoise(x: Float32Array, rmsLevel: number, rng: () => number): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    out[i] = x[i] + (rng() * 2 - 1) * rmsLevel * Math.SQRT2;
  }
  return out;
}

export function rmsOf(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

/** Mix `b` into `a` at the given gain, returning a new buffer. */
export function mix(a: Float32Array, b: Float32Array, gain = 1): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i] + (i < b.length ? b[i] * gain : 0);
  }
  return out;
}

export interface SceneParams {
  durationSec: number;
  seed: number;
  /** Echo attenuation applied to the reference before it reaches the mic. */
  alpha: number;
  /** Acoustic delay in seconds. */
  delaySec: number;
  /** Room RT60 in seconds. */
  rt60: number;
  /** Direct-to-reverberant ratio in dB. Near-field desk setups run 10-20 dB. */
  drrDb?: number;
  /** Additive mic noise, as RMS in the same units as the speech. */
  noiseRms: number;
}

export interface Scene {
  mic: Float32Array;
  reference: Float32Array;
  /** True when an acoustic echo path was actually present. */
  echoPresent: boolean;
  label: string;
}

/**
 * The scenarios the detector has to tell apart.
 *
 * The three `headphones_*` cases and `readback` are the ones that matter: they
 * all have a reference playing and a microphone picking up speech, and none of
 * them is echo. A detector that fires on those is useless, because that is what
 * an ordinary meeting looks like.
 */
export type SceneKind =
  | 'echo_only'
  | 'echo_double_talk'
  | 'echo_listening'
  | 'headphones_listening'
  | 'headphones_turn_taking'
  | 'headphones_overlap'
  | 'readback'
  | 'near_only'
  | 'silence';

export function buildScene(kind: SceneKind, p: SceneParams): Scene {
  const rng = makeRng(p.seed);
  const { durationSec } = p;

  const refUtts =
    kind === 'near_only' || kind === 'silence'
      ? []
      : layoutUtterances(durationSec, rng, { speechRange: [1.2, 3.0], pauseRange: [0.4, 1.5] });
  const reference = renderSpeech(refUtts, durationSec, rng, { f0: 110, level: 0.25 });

  const echoPath = (): Float32Array => {
    const rir = makeRir(p.rt60, rng, p.drrDb ?? 10);
    return convolve(delay(reference, p.delaySec), rir);
  };

  let near: Float32Array;
  let echo: Float32Array | null = null;

  switch (kind) {
    case 'silence':
      near = new Float32Array(Math.round(durationSec * SAMPLE_RATE));
      break;

    case 'echo_only':
      near = new Float32Array(Math.round(durationSec * SAMPLE_RATE));
      echo = echoPath();
      break;

    case 'echo_listening': {
      // The realistic shape of the problem: the user is mostly listening, which
      // is exactly when remote audio or TTS is playing and bleeding into the
      // mic. `echo_double_talk` models a user who talks continuously for the
      // whole scene, which is a worst case rather than the common one.
      const nearUtts = layoutUtterances(durationSec, rng, {
        speechRange: [0.8, 2.0],
        pauseRange: [4.0, 10.0],
        startAt: 1.0,
      });
      near = renderSpeech(nearUtts, durationSec, rng, { f0: 180, level: 0.3 });
      echo = echoPath();
      break;
    }

    case 'headphones_listening': {
      // The false-positive control for `echo_listening`: same duty cycle, same
      // reference activity, no acoustic path.
      const nearUtts = layoutUtterances(durationSec, rng, {
        speechRange: [0.8, 2.0],
        pauseRange: [4.0, 10.0],
        startAt: 1.0,
      });
      near = renderSpeech(nearUtts, durationSec, rng, { f0: 180, level: 0.3 });
      break;
    }

    case 'echo_double_talk': {
      const nearUtts = layoutUtterances(durationSec, rng, {
        speechRange: [0.8, 2.2],
        pauseRange: [0.5, 1.8],
        startAt: 0.3,
      });
      near = renderSpeech(nearUtts, durationSec, rng, { f0: 180, level: 0.3 });
      echo = echoPath();
      break;
    }

    case 'headphones_turn_taking': {
      // The dangerous false positive: the user replies in the reference's gaps,
      // so mic energy trails reference energy at a repeatable-looking offset.
      const nearUtts = layoutReplies(refUtts, durationSec, rng, {
        gapRange: [0.15, 0.6],
        speechRange: [0.8, 2.0],
      });
      near = renderSpeech(nearUtts, durationSec, rng, { f0: 180, level: 0.3 });
      break;
    }

    case 'headphones_overlap': {
      const nearUtts = layoutUtterances(durationSec, rng, {
        speechRange: [1.0, 2.5],
        pauseRange: [0.3, 1.2],
        startAt: 0.15,
      });
      near = renderSpeech(nearUtts, durationSec, rng, { f0: 180, level: 0.3 });
      break;
    }

    case 'readback': {
      // User repeats each reference utterance shortly after it ends. Content
      // correlates; timing does not hold a fixed lag.
      const nearUtts: Utterance[] = refUtts.map(u => {
        const lag = 0.25 + rng() * 0.5;
        return { start: u.end + lag, end: Math.min(durationSec, u.end + lag + (u.end - u.start) * 0.9) };
      });
      near = renderSpeech(nearUtts, durationSec, rng, { f0: 180, level: 0.3 });
      break;
    }

    case 'near_only': {
      const nearUtts = layoutUtterances(durationSec, rng, {
        speechRange: [1.0, 2.5],
        pauseRange: [0.4, 1.5],
      });
      near = renderSpeech(nearUtts, durationSec, rng, { f0: 180, level: 0.3 });
      break;
    }
  }

  let mic = echo ? mix(near, echo, p.alpha) : near;
  mic = addNoise(mic, p.noiseRms, rng);

  return { mic, reference, echoPresent: echo !== null, label: kind };
}
