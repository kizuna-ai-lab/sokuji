/**
 * One session of the fake translator, the file that runs it: a job
 * translator whose answer is the stretch marked with the leg's target, after
 * a delay on the request's clock, with the fault knobs that make a job fail
 * or the unit die. Its unit and its provider are `translator.ts`, the
 * settings side; this file is the session side
 * (`sessionSide.consistency.test.ts`).
 */
import type { Clock } from '../../lib/contract/clock';
import type { TranslationEvents, TranslationSession, TranslationStartRequest } from '../../lib/contract/translation';
import { createJobTranslator } from '../../lib/translation/jobTranslator';

/** The fault knobs. */
export interface FakeTranslatorSettings {
  /** Each answer comes this long after it was asked, in ms. */
  delayMs: number;
  /** A stretch that holds this word fails, and the next is translated; empty: none fails. */
  failOn: string;
  /** A stretch that holds this word is the unit's end; empty: it never dies. */
  dieOn: string;
}
/** Nothing to enter. */
export type FakeTranslatorCredentials = Record<string, never>;
export type FakeTranslatorConfig = FakeTranslatorSettings;

/** The unit's end, as opposed to one job's failure. */
class FakeTranslatorGone extends Error {}

/** Resolves after `ms` on `clock`; rejects, and disarms its timer, when `signal` aborts first. */
function wait(clock: Clock, ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cancel = clock.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      cancel();
      reject(signal.reason ?? new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * One session of the fake translator: a job translator whose answer is the stretch itself, marked with the leg's
 * target (`[ja] Hello.`), so a test reads which direction translated a row.
 */
export function startFakeTranslator(request: TranslationStartRequest<FakeTranslatorConfig, FakeTranslatorCredentials>, events: TranslationEvents): TranslationSession {
  const { clock, config, signal } = request;
  const { target } = request.context.direction;
  return createJobTranslator({
    events,
    clock,
    signal,
    language: target,
    fatal: (error) => error instanceof FakeTranslatorGone,
    async translate(text, job) {
      if (config.delayMs > 0) await wait(clock, config.delayMs, job);
      if (config.dieOn !== '' && text.includes(config.dieOn)) throw new FakeTranslatorGone('The fake translator is gone (fault knob).');
      if (config.failOn !== '' && text.includes(config.failOn)) throw new Error('The fake translator failed this sentence (fault knob).');
      return `[${target}] ${text}`;
    },
  });
}
