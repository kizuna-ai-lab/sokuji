/**
 * OpenAI Translate's deltas → segments (survey §2.9): a stream with no turns,
 * cut by `ContinuousSegments` (Stage 2 translation cuts, rulings 1, 2) — the
 * source by its own silence timer, the translation where the source was cut,
 * stating the source it follows as its origin, all on the request's clock.
 * Gemini's Live Translate half uses the same module (ruling 3).
 *
 * What is this provider's own is its audio. A frame at or above the noise
 * floor opens the translation when none is open and holds it as a delta
 * does, whether it plays or not, so Text only changes playback and nothing
 * else (choice 5); one below the floor does neither, plays inside an open
 * translation and is dropped outside one, as a heartbeat is (translation
 * cuts, choice 11). Each played frame carries the translation's text as it
 * stood at the frame's arrival — a range by arrival (ruling 6; choice 6).
 */
import type { Clock } from '../../lib/contract/clock';
import { ContinuousSegments, type CutSummary, type SegmentSink } from '../../lib/segmentation/continuousSegments';
import type { TranslateConfig } from './config';
import { isQuietFrame } from './wire';

export interface TranslateSegmentsOptions {
  clock: Pick<Clock, 'setTimeout' | 'now'>;
  silence: TranslateConfig['silence'];
  sink: SegmentSink;
  /** Each translation cut, for the Logs (translation cuts, choice 14). */
  cut?: (summary: CutSummary) => void;
}

export class TranslateSegments {
  private readonly segments: ContinuousSegments;

  constructor(o: TranslateSegmentsOptions) {
    this.segments = new ContinuousSegments(o);
  }

  /** A source transcript delta. */
  input(delta: string): void {
    this.segments.sourceText(delta);
  }

  /** A translation transcript delta. */
  output(delta: string): void {
    this.segments.translationText(delta);
  }

  /** An output frame the adapter did not drop as a heartbeat; `play` when this leg plays it (choices 5, 16). */
  audio(pcm: Int16Array, play: boolean): void {
    if (pcm.length === 0) return;
    const quiet = isQuietFrame(pcm);
    if (quiet && !this.segments.translating) return;
    this.segments.audio(pcm, { play, active: !quiet });
  }

  /** A `.done` event, should the endpoint send one (choice 18; translation cuts, choice 13). */
  done(side: 'source' | 'translation'): void {
    this.segments.done(side);
  }

  stop(): void {
    this.segments.stop();
  }
}
