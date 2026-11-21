// src/lib/translation/jobTranslator.ts
//
// A translation session over a translator that is asked and answers: given
// `translate(text) → text`, it cuts each source with the shared cutter, runs
// the stretches as jobs, one at a time and in order, and says each answer as
// one translation segment, whole and final. What a unit adds is its
// `translate`, what it loads to open, and what it lets go to close.
import type { TranslationEvents, TranslationSession } from '../contract/translation';
import { describeCause } from '../diagnostics/describeCause';
import { createSourceCutter, type SourceCutter } from './cutter';

export interface JobTranslatorOptions {
  /**
   * Translates one stretch of source. `signal` aborts when the session stops or ends: an answer or a rejection
   * that comes afterwards is dropped, unsaid.
   */
  translate(text: string, signal: AbortSignal): Promise<string>;
  events: TranslationEvents;
  /** The language the answers are in, stated on every translation. Absent: none is stated. */
  language?: string;
  /** What the session awaits to open: a model loaded, a worker ready. A rejection is the start's. Absent: open at once. */
  open?(): Promise<void>;
  /** What is let go when the session stops, or ends on a fatal failure. Called once. */
  close?(): void | Promise<void>;
  /** The words of a failed job's notice. Absent: the error's own message. */
  failureMessage?(error: unknown): string;
  /** Whether a failure is the unit's end, not one job's (a model that is gone). Absent: no failure is. */
  fatal?(error: unknown): boolean;
}

interface Job { origin: string; text: string }

/**
 * The session. Jobs run strictly in order, across origins: the stretches as the cutter yielded them, one job in
 * flight. A job's answer opens a segment with the job's origin, says the whole answer with all of it stable, and
 * closes it. A job that fails, or is answered with nothing, says `translation_failed` and the next job runs: the
 * row keeps its source. A failure `fatal` names says `failed` and ends the session. `stop()` aborts the job in
 * flight and drops what waits; nothing is said afterwards.
 */
export function createJobTranslator(o: JobTranslatorOptions): TranslationSession {
  const { events } = o;
  const cutters = new Map<string, SourceCutter>();
  /** Origins that closed: a late snapshot of one starts no second cut. */
  const closed = new Set<string>();
  const jobs: Job[] = [];
  const abort = new AbortController();
  let nextRef = 1;
  let running = false;
  /** Stopped, or failed for good: nothing more is asked or said. */
  let over = false;
  let closing: Promise<void> | null = null;

  /** Ends the session, once: the job in flight is aborted, what waits is dropped, and what was opened is let go. */
  const end = (): Promise<void> => {
    over = true;
    if (closing) return closing;
    abort.abort();
    jobs.length = 0;
    cutters.clear();
    try {
      closing = Promise.resolve(o.close?.());
    } catch (error) {
      closing = Promise.reject(error);
    }
    return closing;
  };

  const failedJob = (message: string, extra: { cause?: unknown; reason?: string }) => {
    events.degraded({ code: 'translation_failed', message, ...extra });
  };

  const run = async (job: Job): Promise<void> => {
    let answer: string;
    try {
      answer = await o.translate(job.text, abort.signal);
    } catch (error) {
      // Aborted by the stop, or late after it: expected, not a failure.
      if (over) return;
      const message = o.failureMessage?.(error) ?? describeCause(error);
      if (o.fatal?.(error)) {
        // Let go before it is said: nothing follows `failed`.
        end().catch(() => {});
        events.failed({ message, cause: error });
        return;
      }
      failedJob(message, { cause: error });
      return;
    }
    if (over) return;
    if (answer.trim() === '') {
      failedJob('The translation came back empty.', { reason: 'translation_empty' });
      return;
    }
    const ref = nextRef++;
    events.translationOpened({ ref, origin: job.origin });
    try {
      events.translationText({ ref, text: answer, stableLen: answer.length, ...(o.language === undefined ? {} : { language: o.language }) });
    } finally {
      events.translationClosed({ ref });
    }
  };

  const drain = async (): Promise<void> => {
    running = true;
    try {
      while (jobs.length > 0 && !over) {
        try {
          await run(jobs.shift()!);
        } catch (error) {
          // Not the translation: a listener that threw. Said in the Logs, and the queue moves on.
          if (!over) events.frame({ direction: 'in', type: 'translation.job_error', payload: { error: describeCause(error) } });
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    open: () => (o.open ? o.open() : Promise.resolve()),
    source(snapshot) {
      const { origin } = snapshot;
      if (over || closed.has(origin)) return;
      let cutter = cutters.get(origin);
      if (!cutter) {
        cutter = createSourceCutter();
        cutters.set(origin, cutter);
      }
      const stretches = cutter.feed(snapshot);
      if (snapshot.closed) {
        cutters.delete(origin);
        closed.add(origin);
      }
      for (const { text } of stretches) jobs.push({ origin, text });
      if (!running && jobs.length > 0) void drain();
    },
    stop: () => end(),
  };
}
