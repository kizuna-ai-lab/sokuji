/**
 * From a service's stream time to the run's clock. A streaming service times
 * its words in milliseconds of the audio it received on one connection; that
 * stream stands still while nothing is sent (muted, push-to-talk key up), so
 * its times drift from the clock by every pause. The table records, chunk by
 * chunk, when the audio actually went out, and answers back from stream time
 * to the clock time at which that audio was heard.
 *
 * One table per connection: a reconnect starts the service's stream from zero.
 */
import type { Clock } from './clock';

export interface SentClock {
  /** Audio just handed to the connection: `samples` at `sampleRate`, sent now. */
  sent(samples: number, sampleRate: number): void;
  /**
   * Audio nobody said — silence the app made up, such as a manual turn's release tail — handed over now: it moves the
   * stream on without claiming any clock time. A time inside it answers as now, and the audio heard before it keeps
   * its own times.
   */
  padded(samples: number, sampleRate: number): void;
  /** The clock time at which stream time `streamMs` was heard; undefined when it lies outside what was sent. */
  at(streamMs: number): number | undefined;
}

/** A chunk that starts within this of where the previous one ended continues it (timer jitter, not a pause). The
 *  recording's tracks use it; this table joins chunks by SENT_SLACK_MS. */
export const SENT_JOIN_MS = 250;
/** Spans join when, taken together, as much clock time passed as audio was sent, give or take this much. */
export const SENT_SLACK_MS = 50;
/** How many spans back a new chunk may join: a page stalled this many chunks long still heals. */
const JOIN_BACK = 64;
/** A time this little past the audio sent answers as its end: the service's last word may end after the last chunk. */
const PAST_END_MS = 500;

/**
 * Stream [streamStart, streamEnd] heard over clock [clockStart, clockEnd]; inside it, times count back from the end.
 * `made`: padding nobody said, all of it at `clockEnd`; nothing joins across it.
 */
interface Span { streamStart: number; streamEnd: number; clockStart: number; clockEnd: number; made?: true }

export function createSentClock(clock: Pick<Clock, 'now'>): SentClock {
  // Ordered by stream time; the times asked for are recent, so lookups go from the end.
  const spans: Span[] = [];
  let total = 0;
  return {
    sent(samples, sampleRate) {
      if (!(samples > 0) || !(sampleRate > 0)) return;
      const d = (samples * 1000) / sampleRate;
      const t = clock.now();
      // A chunk of d ms sent at t covers stream [total, total + d] and clock [t - d, t].
      spans.push({ streamStart: total, streamEnd: total + d, clockStart: t - d, clockEnd: t });
      total += d;
      // The newest chunk joins the earliest recent span from which as much clock time has passed as audio was sent:
      // chunks a stalled page sent late, together, rejoin the audio before them once the sending has caught up, while
      // a pause (mute, key up) never rejoins, so the audio before it keeps the times at which it was heard.
      const last = spans.length - 1;
      let from = Math.max(0, last - JOIN_BACK);
      for (let k = last - 1; k >= from; k--) if (spans[k].made) { from = k + 1; break; }
      for (let j = from; j < last; j++) {
        const a = spans[j];
        if (Math.abs((t - a.clockStart) - (total - a.streamStart)) > SENT_SLACK_MS) continue;
        spans.splice(j, spans.length - j, { streamStart: a.streamStart, streamEnd: total, clockStart: a.clockStart, clockEnd: t });
        break;
      }
    },
    padded(samples, sampleRate) {
      if (!(samples > 0) || !(sampleRate > 0)) return;
      const d = (samples * 1000) / sampleRate;
      const t = clock.now();
      spans.push({ streamStart: total, streamEnd: total + d, clockStart: t, clockEnd: t, made: true });
      total += d;
    },
    at(streamMs) {
      if (!(streamMs >= 0) || spans.length === 0) return undefined;
      if (streamMs > total) return streamMs - total <= PAST_END_MS ? spans[spans.length - 1].clockEnd : undefined;
      for (let i = spans.length - 1; i >= 0; i--) {
        const s = spans[i];
        if (s.streamStart <= streamMs && streamMs <= s.streamEnd) return s.made ? s.clockEnd : s.clockEnd - (s.streamEnd - streamMs);
      }
      return undefined;
    },
  };
}
