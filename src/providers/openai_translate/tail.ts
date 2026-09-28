/**
 * A push-to-talk release on an endpoint with no commit and no server VAD
 * (ruling 2; research Q1). The server consumes 200 ms engine frames and
 * holds a shorter remainder until more audio arrives, and its model time
 * advances only with the audio it is sent (the SDK's
 * `RealtimeTranslationInputAudioBufferAppendEvent`): a release that just
 * stops sending leaves the press's last words untranslated until the next
 * press, spliced onto it. So a release sends, at once, the zeros that
 * complete the frame the server holds, then one 200 ms frame of silence
 * every 200 ms, in real time, until the translation has been quiet for
 * `TAIL_QUIET_MS`, and never past `TAIL_MAX_MS` after the release. A press,
 * or audio, ends it at once. Pure: a clock and two callbacks — the adapter
 * sends and frames (choice 7).
 */
import { SAMPLE_RATE } from '../../lib/contract/adapter';
import { every, type Clock } from '../../lib/contract/clock';

/** The engine's frame (the SDK: "Translation consumes 200 ms engine frames"). */
export const FRAME_MS = 200;
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;
/** How long the translation must have been quiet before the tail stops. A starting value the owner's live test tunes (ruling 2). */
export const TAIL_QUIET_MS = 1_000;
/** The tail's cap, from the release. A starting value the owner's live test tunes (ruling 2). */
export const TAIL_MAX_MS = 3_000;

export type TailEnd = 'quiet' | 'cap' | 'press' | 'audio';

/** What one tail did, for the Logs (`turn.tail_end`): what the live test tunes the two constants by. */
export interface TailSummary {
  reason: TailEnd;
  /** The real-time silence sent after the pad. */
  silenceMs: number;
  /** The translation's last text or audio after the release, from the release; null when none came. */
  lastOutputMs: number | null;
  cancelled?: true;
}

/** The zeros that complete the frame the server holds; none when what was sent ends on the grid. */
export function padSamples(sent: number): number {
  return (FRAME_SAMPLES - (sent % FRAME_SAMPLES)) % FRAME_SAMPLES;
}

export interface ReleaseTailOptions {
  clock: Pick<Clock, 'setTimeout' | 'now'>;
  /** Sends pcm up; the adapter counts it into what it has sent. */
  send(pcm: Int16Array): void;
  /** A tail ended by itself, or by a press or audio — never by `cancel`. */
  ended(summary: TailSummary): void;
}

/** One engine frame of silence, sent as it is (never written to). */
const SILENT_FRAME = new Int16Array(FRAME_SAMPLES);

interface Run {
  releasedAt: number;
  lastOutputAt: number | null;
  frames: number;
  cancelled: boolean;
  stop: () => void;
}

export class ReleaseTail {
  private run: Run | null = null;

  constructor(private readonly o: ReleaseTailOptions) {}

  get running(): boolean {
    return this.run !== null;
  }

  /** A release, with or without speech: the pad at once, then the silence in real time. `sent` is what the session sent so far, in samples. Returns the pad's length. */
  start(sent: number, cancelled: boolean): number {
    this.cancel();
    const pad = padSamples(sent);
    if (pad > 0) this.o.send(new Int16Array(pad));
    const run: Run = { releasedAt: this.o.clock.now(), lastOutputAt: null, frames: 0, cancelled, stop: () => {} };
    this.run = run;
    run.stop = every(this.o.clock, FRAME_MS, () => this.tick());
    return pad;
  }

  /** The translation wrote or spoke: its quiet starts again. Ignored while no tail runs. */
  output(): void {
    if (this.run) this.run.lastOutputAt = this.o.clock.now();
  }

  /** A new press, or audio: the tail ends now, and says so. */
  stop(reason: 'press' | 'audio'): void {
    if (this.run) this.finish(reason);
  }

  /** The session ends: the tail stops and says nothing (nothing may follow a stop). */
  cancel(): void {
    const run = this.run;
    this.run = null;
    run?.stop();
  }

  private tick(): void {
    const run = this.run;
    if (!run) return;
    const now = this.o.clock.now();
    if (now - Math.max(run.releasedAt, run.lastOutputAt ?? run.releasedAt) > TAIL_QUIET_MS) {
      this.finish('quiet');
      return;
    }
    if (now - run.releasedAt > TAIL_MAX_MS) {
      this.finish('cap');
      return;
    }
    this.o.send(SILENT_FRAME);
    run.frames += 1;
  }

  private finish(reason: TailEnd): void {
    const run = this.run;
    if (!run) return;
    this.run = null;
    run.stop();
    this.o.ended({
      reason,
      silenceMs: run.frames * FRAME_MS,
      lastOutputMs: run.lastOutputAt === null ? null : run.lastOutputAt - run.releasedAt,
      ...(run.cancelled ? { cancelled: true as const } : {}),
    });
  }
}
