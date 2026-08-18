/**
 * SPIKE (issue #227 follow-up): acoustic echo *detection* from real captured
 * audio, replacing the device-name guesswork in `audioUtils.isLikelyToGenerateFeedback`.
 *
 * Not wired into anything yet. This module is pure logic plus its own state; it
 * has no imports from the audio graph so it can be swept offline.
 *
 * ## What it decides
 *
 * "Is the microphone hearing a delayed copy of something we already know we are
 * playing?" — where the known signals are our TTS ring buffer and the participant
 * capture stream. Both are already available in-process, so no blind acoustic
 * analysis is needed.
 *
 * ## Why the envelope domain
 *
 * Waveform-domain correlation needs matched sample rates and phase alignment;
 * AGC, resampling and loudspeaker non-linearity all destroy that. The envelope
 * survives them, and a binary "is there echo" verdict does not need AEC-grade
 * precision. At a 100 Hz frame rate a 60-lag search over a 2 s window is ~12k
 * multiply-adds per tick — free.
 *
 * dB rather than linear envelope: acoustic attenuation is multiplicative in
 * linear terms and therefore a constant offset in dB, which mean-removal cancels
 * exactly. It also keeps quiet speech from being swamped by loud speech.
 *
 * ## What separates echo from normal conversation
 *
 * A high correlation peak alone is NOT enough — turn-taking produces one too
 * (the reply follows the remote utterance at a repeatable-looking offset). The
 * discriminators are:
 *
 *   1. the peak lag must be physically plausible (a few ms to ~600 ms), and
 *   2. the peak lag must stay put across consecutive ticks. An acoustic path
 *      has a fixed delay; conversational turn-taking does not.
 */

/** One detection tick's raw measurement against a single reference. */
export interface CorrelationResult {
  /** Peak normalized cross-correlation over the searched lag range, in [-1, 1]. */
  rho: number;
  /** Lag at the peak, in frames. Positive means the reference leads the mic. */
  lagFrames: number;
  /** Strongest correlation found at the decoy lags, where echo cannot exist. */
  decoyRho: number;
  /**
   * `rho - decoyRho`: how much better the best plausible lag explains the
   * microphone than an impossible one does.
   *
   * Raw `rho` alone cannot separate echo from two people talking at once. The
   * peak is a maximum over ~60 lags of a strongly autocorrelated envelope, so
   * its null distribution sits well above zero and unrelated speech routinely
   * peaks at 0.5-0.6 by multiple comparison alone.
   *
   * An earlier attempt estimated that null from the lag profile inside the
   * search range and failed outright — measured PSR was *higher* for headphone
   * turn-taking than for real echo. The reason is that a speech envelope stays
   * autocorrelated for several hundred milliseconds, which is wider than the
   * whole search range, so a true echo's profile is broad and high rather than a
   * sharp spike.
   *
   * The null therefore has to come from lags where an echo physically cannot be:
   * seconds away, where envelope autocorrelation has died out. There a genuine
   * echo scores near zero while a coincidence scores just as well as it does
   * anywhere else — which is exactly the contrast this measures.
   */
  contrast: number;
  /** False when either window was too quiet or too flat to correlate meaningfully. */
  valid: boolean;
}

export interface EchoVerdict {
  /** True once a plausible, stable echo path has been observed for long enough. */
  detected: boolean;
  /** Which reference best explains the microphone content, when detected. */
  cause: string | null;
  /** Peak correlation of the winning reference on this tick. */
  rho: number;
  /** How far the winning reference beat its decoy lags on this tick. */
  contrast: number;
  /** Delay of the winning reference on this tick, in milliseconds. */
  lagMs: number;
  /** Votes currently backing the leading lag bin. */
  votes: number;
}

export interface EchoDetectorOptions {
  /** PCM sample rate of every stream fed to this detector. */
  sampleRate: number;
  /** Envelope frame length. 10 ms → a 100 Hz envelope. */
  frameMs?: number;
  /** Correlation window. Long enough to span a phrase, short enough to react. */
  windowMs?: number;
  /**
   * Longest acoustic delay to search for. Our own playback path sits well under
   * 400 ms; a third-party meeting app's output buffer is unknown and Bluetooth
   * adds 150-300 ms, so the participant path needs more headroom.
   */
  maxLagMs?: number;
  /**
   * Shortest lag to consider. Below this a "match" is more likely to be the same
   * signal reaching us twice electrically (a routing loop) than acoustically.
   */
  minLagMs?: number;
  /** Envelope floor. Silence lands here instead of at -infinity. */
  floorDb?: number;
  /** Peak correlation a reference must reach to count as a candidate. */
  rhoThreshold?: number;
  /** How far the peak must beat the decoy lags to count as a candidate. */
  contrastThreshold?: number;
  /**
   * Lags, in milliseconds, used as the null hypothesis. They must be far enough
   * out that the speech envelope has decorrelated from itself — a few seconds.
   */
  decoyLagsMs?: number[];
  /** Width of the lag agreement bin. Two ticks within this land in one bin. */
  lagToleranceMs?: number;
  /** How many recent ticks are kept in the voting history. */
  historyTicks?: number;
  /** Votes needed, within one lag bin, to declare a detection. */
  minVotes?: number;
  /** Ticks with no qualifying vote before an existing detection is dropped. */
  clearAfterTicks?: number;
  /**
   * A window whose envelope barely moves carries no timing information, and its
   * normalized correlation is numerically meaningless. Skip those.
   */
  minEnvelopeStdDb?: number;
}

interface ResolvedOptions extends Required<EchoDetectorOptions> {}

const DEFAULTS: Omit<Required<EchoDetectorOptions>, 'sampleRate'> = {
  frameMs: 10,
  windowMs: 2000,
  maxLagMs: 600,
  minLagMs: 20,
  floorDb: -60,
  rhoThreshold: 0.5,
  contrastThreshold: 0.4,
  decoyLagsMs: [2000, 3000, 4000, 5000],
  lagToleranceMs: 40,
  historyTicks: 80,
  minVotes: 14,
  clearAfterTicks: 120,
  minEnvelopeStdDb: 3,
};

/**
 * Turns a PCM stream into a fixed-rate dB envelope held in a ring buffer.
 *
 * Chunk boundaries from the audio callbacks do not align to frame boundaries, so
 * a partial frame is carried across pushes rather than discarded — otherwise the
 * envelope's time base would drift against the other streams, which is precisely
 * the quantity being measured.
 */
export class EnvelopeTracker {
  private readonly frameSamples: number;
  private readonly floorDb: number;
  private readonly ring: Float32Array;
  private readonly capacity: number;

  /** Running sum of squares for the frame currently being filled. */
  private partialSumSq = 0;
  private partialCount = 0;
  /** Total frames ever emitted; the ring holds the last `capacity` of them. */
  private produced = 0;

  constructor(frameSamples: number, capacityFrames: number, floorDb: number) {
    this.frameSamples = frameSamples;
    this.capacity = capacityFrames;
    this.ring = new Float32Array(capacityFrames);
    this.floorDb = floorDb;
  }

  get frameCount(): number {
    return this.produced;
  }

  push(pcm: Float32Array): void {
    for (let i = 0; i < pcm.length; i++) {
      const s = pcm[i];
      this.partialSumSq += s * s;
      this.partialCount++;
      if (this.partialCount === this.frameSamples) {
        this.emitFrame();
      }
    }
  }

  private emitFrame(): void {
    const rms = Math.sqrt(this.partialSumSq / this.frameSamples);
    // 1e-7 ≈ -140 dBFS, far below the floor, so it only guards log(0).
    const db = Math.max(this.floorDb, 20 * Math.log10(rms + 1e-7));
    this.ring[this.produced % this.capacity] = db;
    this.produced++;
    this.partialSumSq = 0;
    this.partialCount = 0;
  }

  /**
   * Copy the most recent `n` frames into `out`, oldest first.
   * Returns false when fewer than `n` frames exist yet.
   */
  copyLast(n: number, out: Float32Array): boolean {
    if (n > this.capacity || this.produced < n) return false;
    const start = this.produced - n;
    for (let i = 0; i < n; i++) {
      out[i] = this.ring[(start + i) % this.capacity];
    }
    return true;
  }

  reset(): void {
    this.partialSumSq = 0;
    this.partialCount = 0;
    this.produced = 0;
    this.ring.fill(0);
  }
}

/**
 * Peak normalized cross-correlation of `mic` against `ref` over a lag range.
 *
 * `mic` holds W frames. `ref` holds W + maxLag frames covering the same window
 * *plus* maxLag frames of extra history, so that every lag is evaluated over the
 * full mic window rather than a shrinking overlap — otherwise long lags would be
 * scored on less data and the peak would bias short.
 *
 * Alignment: for lag τ, mic[n] is compared against ref[n + maxLag - τ].
 *
 * Mean and variance are recomputed per lag over exactly the slice used. That is
 * O(W · L) instead of O(W + L), which at these sizes is still nothing, and it
 * avoids the bias a single window-wide mean would introduce.
 */
/**
 * Correlate the mic window against one reference alignment.
 *
 * `off` is the index in `ref` where the window being compared begins.
 * Returns NaN when the reference slice carries too little variation to correlate.
 */
function corrAt(
  mic: Float32Array,
  ref: Float32Array,
  micMean: number,
  micStd: number,
  off: number,
  w: number,
  minStd: number
): number {
  let refMean = 0;
  for (let i = 0; i < w; i++) refMean += ref[off + i];
  refMean /= w;

  let refVar = 0;
  let cov = 0;
  for (let i = 0; i < w; i++) {
    const dr = ref[off + i] - refMean;
    cov += dr * (mic[i] - micMean);
    refVar += dr * dr;
  }
  const refStd = Math.sqrt(refVar / w);
  if (refStd < minStd) return NaN;
  return cov / (w * micStd * refStd);
}

/**
 * Peak normalized cross-correlation of `mic` against `ref` over the plausible
 * lag range, contrasted against decoy lags where an echo cannot exist.
 *
 * `mic` holds W frames. `ref` holds W + maxDecoyLag frames covering the same
 * window plus enough extra history for both the lag search and the decoys, so
 * every lag is scored over the full mic window rather than a shrinking overlap.
 *
 * Alignment: for lag τ, mic[n] is compared against ref[n + maxDecoyLag - τ].
 */
export function peakCorrelation(
  mic: Float32Array,
  ref: Float32Array,
  minLag: number,
  maxLag: number,
  decoyLags: number[],
  minStd: number
): CorrelationResult {
  const w = mic.length;
  const maxDecoy = decoyLags.length ? Math.max(...decoyLags) : maxLag;
  const miss: CorrelationResult = { rho: 0, lagFrames: 0, decoyRho: 0, contrast: 0, valid: false };
  if (ref.length < w + maxDecoy) return miss;

  let micMean = 0;
  for (let i = 0; i < w; i++) micMean += mic[i];
  micMean /= w;

  let micVar = 0;
  for (let i = 0; i < w; i++) {
    const d = mic[i] - micMean;
    micVar += d * d;
  }
  const micStd = Math.sqrt(micVar / w);
  if (micStd < minStd) return miss;

  let bestRho = -Infinity;
  let bestLag = 0;
  let found = false;

  for (let lag = minLag; lag <= maxLag; lag++) {
    const rho = corrAt(mic, ref, micMean, micStd, maxDecoy - lag, w, minStd);
    if (Number.isNaN(rho)) continue;
    found = true;
    if (rho > bestRho) {
      bestRho = rho;
      bestLag = lag;
    }
  }
  if (!found) return miss;

  // The decoys are the null hypothesis. Taking the strongest of them is
  // deliberately conservative: it is the best score chance alone achieved on
  // this very window, so the peak has to beat coincidence at its own best.
  let decoyRho = -Infinity;
  let decoyFound = false;
  for (const lag of decoyLags) {
    const rho = corrAt(mic, ref, micMean, micStd, maxDecoy - lag, w, minStd);
    if (Number.isNaN(rho)) continue;
    decoyFound = true;
    if (rho > decoyRho) decoyRho = rho;
  }
  // Without a usable decoy there is no null to compare against, and passing the
  // peak through unchallenged is how the earlier false-positive rate happened.
  if (!decoyFound) return miss;

  return { rho: bestRho, lagFrames: bestLag, decoyRho, contrast: bestRho - decoyRho, valid: true };
}

/** What one tick observed, before any temporal smoothing. */
export interface Observation {
  /** Reference with the strongest evidence, or null when nothing was measurable. */
  winner: string | null;
  rho: number;
  contrast: number;
  lagFrames: number;
}

export interface DecisionParams {
  /** Peak correlation an observation must reach to cast a vote. */
  rhoThreshold: number;
  /** How far the peak must beat the decoy lags before it may cast a vote. */
  contrastThreshold: number;
  /** How many recent ticks are kept in the voting history. */
  historyTicks: number;
  /** Votes needed, within one lag bin, to declare a detection. */
  minVotes: number;
  /** Width of a lag agreement bin, in frames. */
  lagBinFrames: number;
  /** Ticks with no qualifying vote before an existing detection is dropped. */
  clearAfterTicks: number;
}

export interface DecisionState {
  /** Ring of recent observations, newest last, capped at `historyTicks`. */
  history: Observation[];
  /** Consecutive ticks that produced no qualifying vote. */
  idleTicks: number;
  detected: boolean;
  cause: string | null;
  lagFrames: number;
  votes: number;
}

export function initialDecisionState(): DecisionState {
  return { history: [], idleTicks: 0, detected: false, cause: null, lagFrames: 0, votes: 0 };
}

/**
 * Fold one observation into the detection state.
 *
 * Kept pure so the offline sweep and the live detector run identical logic — a
 * sweep that tunes something other than what ships is worse than no sweep.
 *
 * ## Why votes rather than a consecutive streak
 *
 * Requiring N consecutive strong ticks fails the case that matters most: while
 * the user is speaking, their own voice dominates the microphone envelope and
 * the echo becomes invisible, breaking the streak. Demanding an unbroken run
 * therefore demands the user stay silent for the whole window, which they do not.
 *
 * Counting votes in a lag histogram tolerates those gaps while keeping the
 * property that actually separates echo from coincidence: a real acoustic path
 * has one fixed delay, so its evidence piles up in a single lag bin, whereas two
 * people happening to talk over each other produce strong peaks at lags that
 * scatter across the search range.
 */
export function stepDecision(
  state: DecisionState,
  obs: Observation,
  p: DecisionParams
): DecisionState {
  const history = state.history.length >= p.historyTicks
    ? [...state.history.slice(state.history.length - p.historyTicks + 1), obs]
    : [...state.history, obs];

  // Tally strong observations per (reference, lag bin).
  const tally = new Map<string, { votes: number; lagSum: number }>();
  let best: { key: string; votes: number; lagSum: number } | null = null;

  for (const o of history) {
    if (o.winner === null || o.rho < p.rhoThreshold || o.contrast < p.contrastThreshold) continue;
    const bin = Math.round(o.lagFrames / p.lagBinFrames);
    const key = `${o.winner}#${bin}`;
    const entry = tally.get(key) ?? { votes: 0, lagSum: 0 };
    entry.votes++;
    entry.lagSum += o.lagFrames;
    tally.set(key, entry);
    if (best === null || entry.votes > best.votes) best = { key, ...entry };
  }

  const next: DecisionState = { ...state, history };

  if (best === null) {
    next.idleTicks = state.idleTicks + 1;
    next.votes = 0;
    if (next.idleTicks >= p.clearAfterTicks) {
      next.detected = false;
      next.cause = null;
    }
    return next;
  }

  const qualifiedThisTick =
    obs.winner !== null && obs.rho >= p.rhoThreshold && obs.contrast >= p.contrastThreshold;
  next.idleTicks = qualifiedThisTick ? 0 : state.idleTicks + 1;
  next.votes = best.votes;

  if (best.votes >= p.minVotes) {
    next.detected = true;
    next.cause = best.key.slice(0, best.key.lastIndexOf('#'));
    next.lagFrames = Math.round(best.lagSum / best.votes);
  } else if (next.idleTicks >= p.clearAfterTicks) {
    next.detected = false;
    next.cause = null;
  }

  return next;
}

/** A named reference signal the microphone might be echoing. */
interface Reference {
  id: string;
  tracker: EnvelopeTracker;
}

/**
 * Multi-reference echo detector.
 *
 * Feed it microphone PCM and one or more named reference PCM streams, call
 * `tick()` on a timer, and it reports whether the mic is hearing a delayed copy
 * of one of them — and which one.
 *
 * Attribution matters because the remedy differs: TTS bleed and meeting-audio
 * bleed both say "wear headphones", but a routing loop does not. It matters
 * doubly when the participant source is whole-system loopback, because our own
 * TTS is inside that reference too and would otherwise be blamed on the meeting.
 */
export class EchoDetector {
  private readonly opts: ResolvedOptions;
  private readonly frameSamples: number;
  private readonly windowFrames: number;
  private readonly maxLagFrames: number;
  private readonly minLagFrames: number;
  private readonly decoyLagFrames: number[];
  private readonly maxDecoyFrames: number;

  private readonly mic: EnvelopeTracker;
  private readonly refs: Reference[] = [];

  private readonly micWindow: Float32Array;
  private readonly refWindow: Float32Array;

  private state: DecisionState = initialDecisionState();
  private readonly decision: DecisionParams;

  constructor(options: EchoDetectorOptions) {
    this.opts = { ...DEFAULTS, ...options };
    const { sampleRate, frameMs, windowMs, maxLagMs, minLagMs, floorDb } = this.opts;

    this.decision = {
      rhoThreshold: this.opts.rhoThreshold,
      contrastThreshold: this.opts.contrastThreshold,
      historyTicks: this.opts.historyTicks,
      minVotes: this.opts.minVotes,
      lagBinFrames: Math.max(1, Math.round(this.opts.lagToleranceMs / frameMs)),
      clearAfterTicks: this.opts.clearAfterTicks,
    };

    this.frameSamples = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
    this.windowFrames = Math.max(2, Math.round(windowMs / frameMs));
    this.maxLagFrames = Math.max(1, Math.round(maxLagMs / frameMs));
    this.minLagFrames = Math.max(0, Math.round(minLagMs / frameMs));
    this.decoyLagFrames = this.opts.decoyLagsMs.map(ms => Math.round(ms / frameMs));
    this.maxDecoyFrames = this.decoyLagFrames.length
      ? Math.max(...this.decoyLagFrames)
      : this.maxLagFrames;

    // References need the window plus the deepest lag looked at — the decoys sit
    // seconds back, so they, not the search range, set the history depth.
    const refCapacity = this.windowFrames + this.maxDecoyFrames;
    this.mic = new EnvelopeTracker(this.frameSamples, this.windowFrames, floorDb);
    this.micWindow = new Float32Array(this.windowFrames);
    this.refWindow = new Float32Array(refCapacity);
  }

  /** Register a reference stream. Ids are the values reported as `cause`. */
  addReference(id: string): void {
    if (this.refs.some(r => r.id === id)) return;
    this.refs.push({
      id,
      tracker: new EnvelopeTracker(
        this.frameSamples,
        this.windowFrames + this.maxDecoyFrames,
        this.opts.floorDb
      ),
    });
  }

  pushMic(pcm: Float32Array): void {
    this.mic.push(pcm);
  }

  pushReference(id: string, pcm: Float32Array): void {
    const ref = this.refs.find(r => r.id === id);
    if (ref) ref.tracker.push(pcm);
  }

  /**
   * Evaluate every reference and update the verdict.
   *
   * Call on a timer (~4 Hz). Calling faster costs little but shortens the wall
   * time a `streakToDetect` streak represents, which is the actual guard against
   * a transient conversational coincidence — so the two must be tuned together.
   */
  /**
   * Measure every reference and return the strongest match, without applying any
   * temporal smoothing. Exposed so a sweep can record raw observations once and
   * replay the decision layer over many thresholds.
   */
  observe(): Observation {
    const none: Observation = { winner: null, rho: 0, contrast: 0, lagFrames: 0 };
    if (!this.mic.copyLast(this.windowFrames, this.micWindow)) return none;

    let winner: string | null = null;
    let bestRho = 0;
    let bestContrast = -Infinity;
    let bestLag = 0;

    for (const ref of this.refs) {
      if (!ref.tracker.copyLast(this.windowFrames + this.maxDecoyFrames, this.refWindow)) {
        continue;
      }
      const result = peakCorrelation(
        this.micWindow,
        this.refWindow,
        this.minLagFrames,
        this.maxLagFrames,
        this.decoyLagFrames,
        this.opts.minEnvelopeStdDb
      );
      // Ranked by contrast, not rho: with whole-system loopback our own TTS sits
      // inside the participant reference too, so both can show a high rho. The
      // one that beats its own null by more is the one actually explaining the
      // microphone.
      if (result.valid && result.contrast > bestContrast) {
        bestRho = result.rho;
        bestContrast = result.contrast;
        bestLag = result.lagFrames;
        winner = ref.id;
      }
    }

    if (winner === null) return none;
    return { winner, rho: bestRho, contrast: bestContrast, lagFrames: bestLag };
  }

  tick(): EchoVerdict {
    const obs = this.observe();
    this.state = stepDecision(this.state, obs, this.decision);
    return {
      detected: this.state.detected,
      cause: this.state.cause,
      rho: obs.rho,
      contrast: obs.contrast,
      lagMs: (this.state.detected ? this.state.lagFrames : obs.lagFrames) * this.opts.frameMs,
      votes: this.state.votes,
    };
  }

  reset(): void {
    this.mic.reset();
    for (const r of this.refs) r.tracker.reset();
    this.state = initialDecisionState();
  }
}
