import { EchoDetector } from './echoDetector';

/**
 * Echo attribution across every machine-played → capture path we can reference.
 *
 * One monitor owns three detectors, each a (probe × reference × lag-band) set:
 *
 *   M1  probe=mic          refs: TTS @20-600ms, participant @20-600ms
 *       → 'tts-echo'      our translation left the speakers and hit the mic
 *       → 'meeting-echo'  the meeting app's audio left the speakers and hit the mic
 *   M2  probe=participant  ref: TTS @0-5000ms (decoys 8-15s)
 *       → 'self-capture'  (lag < 600ms)  the participant source is capturing
 *                          Sokuji's own playback electrically (whole-system
 *                          loopback, macOS global tap, Sokuji picked as source)
 *       → 'far-end-echo'  (lag ≥ 600ms) our translation went to the meeting,
 *                          a remote device played and re-captured it, and it
 *                          came back inside the remote stream
 *   M3  probe=mic          ref: TTS @0-40ms, rho ≥ 0.9
 *       → 'routing-loop'  the selected input device IS this machine's playback
 *                          (monitor-of-virtual-speaker, stereo mix, cable)
 *
 * The TTS reference is the player's MAIN ring only. The passthrough ring must
 * never be used as a reference: its content is the microphone itself, so speech
 * autocorrelation would fire on it even with headphones on.
 *
 * Thresholds for M1 come from the offline sweep in echoDetector.sweep.test.ts
 * (94% TPR on realistic listening scenes, 0/100 false positives). M2/M3 bands
 * are analytically chosen, guarded by the same decoy-contrast statistic; their
 * signals are electrical or network-return copies, far stronger than acoustic
 * bleed, so the margin is larger than anything the sweep covered.
 */

export type EchoCause =
  | 'tts-echo'
  | 'meeting-echo'
  | 'far-end-echo'
  | 'self-capture'
  | 'routing-loop';

export interface EchoNoticeState {
  cause: EchoCause;
  lagMs: number;
  rho: number;
}

export interface EchoMonitorHooks {
  /** Pull the TTS PCM actually played out since the last call (Float32, 24 kHz). */
  readPlayedTts: () => Float32Array;
  /** Fired when the aggregate verdict changes; null means all clear. */
  onChange: (state: EchoNoticeState | null) => void;
  /** Optional diagnostics line, at most one per second, for the logs panel. */
  onDiagnostic?: (line: string) => void;
}

/** More actionable causes outrank vaguer ones when several detectors fire. */
const CAUSE_PRIORITY: EchoCause[] = [
  'routing-loop',
  'self-capture',
  'tts-echo',
  'meeting-echo',
  'far-end-echo',
];

export const ECHO_TICK_MS = 250;
const DIAGNOSTIC_EVERY_TICKS = 4; // once per second at a 250 ms tick

export class EchoMonitor {
  private readonly hooks: EchoMonitorHooks;

  /** M1: acoustic echo into the microphone, attributed TTS vs meeting audio. */
  private readonly micAcoustic: EchoDetector;
  /** M2: Sokuji's own audio inside the participant stream (electrical or returned). */
  private readonly participantVsTts: EchoDetector;
  /** M3: near-zero-lag electrical loop into the microphone. */
  private readonly micLoop: EchoDetector;

  private timer: ReturnType<typeof setInterval> | null = null;
  private lastReported: EchoCause | null = null;
  private ticks = 0;

  constructor(hooks: EchoMonitorHooks, sampleRate = 24000) {
    this.hooks = hooks;

    this.micAcoustic = new EchoDetector({ sampleRate });
    this.micAcoustic.addReference('tts');
    this.micAcoustic.addReference('participant');

    this.participantVsTts = new EchoDetector({ sampleRate });
    this.participantVsTts.addReference('tts', {
      minLagMs: 0,
      maxLagMs: 5000,
      decoyLagsMs: [8000, 10000, 12000, 15000],
    });

    // Electrical loops are near-lossless copies, so demand near-perfect
    // correlation and let the verdict both build and clear quickly.
    this.micLoop = new EchoDetector({
      sampleRate,
      rhoThreshold: 0.9,
      historyTicks: 40,
      minVotes: 8,
      clearAfterTicks: 40,
    });
    this.micLoop.addReference('tts', { minLagMs: 0, maxLagMs: 40 });
  }

  /** Feed microphone PCM (post-AEC, 24 kHz mono). */
  pushMic(pcm: Float32Array | Int16Array): void {
    this.micAcoustic.pushMic(pcm);
    this.micLoop.pushMic(pcm);
  }

  /** Feed participant-capture PCM (loopback / per-app / tab, 24 kHz mono). */
  pushParticipant(pcm: Float32Array | Int16Array): void {
    this.micAcoustic.pushReference('participant', pcm);
    this.participantVsTts.pushMic(pcm);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tickOnce(), ECHO_TICK_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.micAcoustic.reset();
    this.participantVsTts.reset();
    this.micLoop.reset();
    this.ticks = 0;
    if (this.lastReported !== null) {
      this.lastReported = null;
      this.hooks.onChange(null);
    }
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** One evaluation step. Exposed for tests; production runs it on a timer. */
  tickOnce(): void {
    const tts = this.hooks.readPlayedTts();
    if (tts.length > 0) {
      this.micAcoustic.pushReference('tts', tts);
      this.participantVsTts.pushReference('tts', tts);
      this.micLoop.pushReference('tts', tts);
    }

    const loop = this.micLoop.tick();
    const acoustic = this.micAcoustic.tick();
    const participant = this.participantVsTts.tick();

    const active = new Map<EchoCause, EchoNoticeState>();
    if (loop.detected) {
      active.set('routing-loop', { cause: 'routing-loop', lagMs: loop.lagMs, rho: loop.rho });
    }
    if (acoustic.detected) {
      const cause: EchoCause = acoustic.cause === 'participant' ? 'meeting-echo' : 'tts-echo';
      active.set(cause, { cause, lagMs: acoustic.lagMs, rho: acoustic.rho });
    }
    if (participant.detected) {
      const cause: EchoCause = participant.lagMs < 600 ? 'self-capture' : 'far-end-echo';
      active.set(cause, { cause, lagMs: participant.lagMs, rho: participant.rho });
    }

    const winner = CAUSE_PRIORITY.find(c => active.has(c)) ?? null;
    if (winner !== this.lastReported) {
      this.lastReported = winner;
      this.hooks.onChange(winner ? active.get(winner)! : null);
    }

    if (this.hooks.onDiagnostic && this.ticks % DIAGNOSTIC_EVERY_TICKS === 0) {
      this.hooks.onDiagnostic(
        `echo mic[rho=${acoustic.rho.toFixed(2)} ctr=${acoustic.contrast.toFixed(2)} lag=${acoustic.lagMs}ms votes=${acoustic.votes}] ` +
        `part[rho=${participant.rho.toFixed(2)} ctr=${participant.contrast.toFixed(2)} lag=${participant.lagMs}ms votes=${participant.votes}] ` +
        `loop[rho=${loop.rho.toFixed(2)} votes=${loop.votes}] → ${winner ?? 'clear'}`
      );
    }
    this.ticks++;
  }
}
