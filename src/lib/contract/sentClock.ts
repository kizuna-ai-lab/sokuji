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
  /** The clock time at which stream time `streamMs` was heard; undefined when it lies outside what was sent. */
  at(streamMs: number): number | undefined;
}

/** A chunk that starts within this of where the previous one ended continues it (timer jitter, not a pause). */
export const SENT_JOIN_MS = 250;
/** A time this little past the audio sent answers as its end: the service's last word may end after the last chunk. */
const PAST_END_MS = 500;

interface Span { streamStart: number; streamEnd: number; clockEnd: number }

export function createSentClock(clock: Pick<Clock, 'now'>): SentClock {
  // Ordered by stream time; the times asked for are recent, so lookups go from the end.
  const spans: Span[] = [];
  let total = 0;
  return {
    sent(samples, sampleRate) {
      if (!(samples > 0) || !(sampleRate > 0)) return;
      const d = (samples * 1000) / sampleRate;
      const t = clock.now();
      const last = spans[spans.length - 1];
      // A chunk of d ms sent at t covers stream [total, total + d] and clock [t - d, t].
      if (last && Math.abs(t - d - last.clockEnd) <= SENT_JOIN_MS) {
        last.streamEnd += d;
        last.clockEnd = t;
      } else {
        spans.push({ streamStart: total, streamEnd: total + d, clockEnd: t });
      }
      total += d;
    },
    at(streamMs) {
      if (!(streamMs >= 0) || spans.length === 0) return undefined;
      if (streamMs > total) return streamMs - total <= PAST_END_MS ? spans[spans.length - 1].clockEnd : undefined;
      for (let i = spans.length - 1; i >= 0; i--) {
        const s = spans[i];
        if (s.streamStart <= streamMs && streamMs <= s.streamEnd) return s.clockEnd - (s.streamEnd - streamMs);
      }
      return undefined;
    },
  };
}
