/**
 * A push-to-talk release on Live Translate (Gemini/AST2 follow-up, ruling
 * 4). Live Translate runs about a second behind its input, and its model
 * time advances only with the audio it is sent: a release that just stops
 * sending leaves the press's last words untranslated until the next press
 * (the owner's probe). So a release keeps sending one 100 ms frame of
 * silence every 100 ms, in real time, until the model has been quiet — no
 * transcription of either side — for `TAIL_QUIET_MS`, and never past
 * `TAIL_MAX_MS` after the release. Quiet counts transcriptions only, where
 * Translate's tail counts its audio too: Live Translate's output is a
 * real-time stream, silence included, so its audio never stops and every
 * tail would run to the cap (Gemini/AST2 follow-up, choice 12). A press,
 * audio or typed text ends it at once. Audio cannot, under push-to-talk:
 * the runner sends audio only while the key is held, and that press has
 * ended the tail first; the reason stays for any other caller. The adapter
 * holds the press's `activityEnd` until the tail ends (Gemini/AST2
 * follow-up, choice 11). Pure: a clock and two callbacks — the adapter
 * sends and frames.
 *
 * Copied from OpenAI Translate's `tail.ts`, not lifted (Gemini/AST2
 * follow-up, choice 10): it is the second user, and the house rule lifts
 * at the third; this copy drops the pad to Translate's 200 ms engine grid,
 * which Gemini has none of, frames at 100 ms, and counts quiet by
 * transcriptions alone; and lifting would edit Translate's tail before its
 * live test. The beat counting is the same, for the same reasons.
 */
import { SAMPLE_RATE } from '../../lib/contract/adapter';
import { every, type Clock } from '../../lib/contract/clock';

/** One frame of the tail: the probe's own pace, which the server consumed. */
export const FRAME_MS = 100;
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;
/** How long the model must have been quiet before the tail stops: the ruling's second, which the owner's live test tunes. */
export const TAIL_QUIET_MS = 1_000;
/** The tail's cap, from the release: the ruling's three seconds, which the owner's live test tunes. */
export const TAIL_MAX_MS = 3_000;

export type TailEnd = 'quiet' | 'cap' | 'press' | 'audio' | 'text';

/** What one tail did, for the Logs (`turn.tail_end`): what the live test tunes the two constants by. */
export interface TailSummary {
  reason: TailEnd;
  /** The real-time silence sent. */
  silenceMs: number;
  /** The model's last transcription after the release, from the release; null when none came. */
  lastOutputMs: number | null;
  cancelled?: true;
}

export interface ReleaseTailOptions {
  clock: Pick<Clock, 'setTimeout' | 'now'>;
  /** Sends pcm up. */
  send(pcm: Int16Array): void;
  /** A tail ended by itself, or by a press, audio or typed text — never by `cancel`. */
  ended(summary: TailSummary): void;
}

/** One frame of silence, sent as it is (never written to). */
const SILENT_FRAME = new Int16Array(FRAME_SAMPLES);

interface Run {
  /** Kept only for the summary's `lastOutputMs`; the ends never read it. */
  releasedAt: number;
  lastOutputAt: number | null;
  /** Frames run so far, counted at the top of every tick — never `now() - releasedAt`: an on-time timer can read either side of its beat, and a wall clock stepped back would make it negative forever, as OpenAI Translate's tail found. */
  beats: number;
  /** The beat `output()` last landed on; 0 (the release itself) when none has. */
  lastOutputBeat: number;
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

  /** A release, with or without speech: silence in real time from the next beat. */
  start(cancelled: boolean): void {
    this.cancel();
    const run: Run = { releasedAt: this.o.clock.now(), lastOutputAt: null, beats: 0, lastOutputBeat: 0, frames: 0, cancelled, stop: () => {} };
    this.run = run;
    run.stop = every(this.o.clock, FRAME_MS, () => this.tick());
  }

  /** The model transcribed or translated: its quiet starts again. Ignored while no tail runs. */
  output(): void {
    if (this.run) {
      this.run.lastOutputAt = this.o.clock.now();
      this.run.lastOutputBeat = this.run.beats;
    }
  }

  /** A new press, audio or typed text: the tail ends now, and says so. */
  stop(reason: 'press' | 'audio' | 'text'): void {
    if (this.run) this.finish(reason);
  }

  /** The session ends, or its connection is lost: the tail stops and says nothing. */
  cancel(): void {
    const run = this.run;
    this.run = null;
    run?.stop();
  }

  private tick(): void {
    const run = this.run;
    if (!run) return;
    run.beats += 1;
    // Beats, not `clock.now()` deltas (see `Run.beats`): quiet first, then the cap.
    if (run.beats - run.lastOutputBeat > TAIL_QUIET_MS / FRAME_MS) {
      this.finish('quiet');
      return;
    }
    if (run.beats > TAIL_MAX_MS / FRAME_MS) {
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
