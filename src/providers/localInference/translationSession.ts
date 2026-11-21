/**
 * One session of the local provider's translation as a unit that only
 * translates: a translation model on this machine, or Bing, behind the
 * translation contract. It is handed another unit's source text; the shared
 * cutter decides which stretches are sent (`jobTranslator`), and each answer
 * is one translation segment. Whose text it is, where the translations are
 * shown and who reads them aloud are the caller's.
 *
 * The engine is loaded for the leg's one direction when the session opens,
 * and a model that does not load is the start's failure. One job failing
 * costs that job; a lost GPU device, or a worker that dies, ends the session.
 */
import { AdapterStartError } from '../../lib/contract/adapter';
import { framePayload } from '../../lib/contract/framePayload';
import type { TranslationEvents, TranslationSession, TranslationStartRequest } from '../../lib/contract/translation';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { isSupportedByBing } from '../../lib/bing-translator/languageMap';
import { AUTO } from '../../lib/language/code';
import { createJobTranslator, JOB_TIMEOUT_MS } from '../../lib/translation/jobTranslator';
import { GPU_OUT_OF_MEMORY, humanizeTranslationError, isDeviceLost, isGpuOutOfMemory } from './adapter';
import type { TranslationLike } from './engines';

/** The local translation model that is Bing: online, nothing to download, its own list of languages. */
export const BING_TRANSLATOR = 'bing-translator';

/**
 * The unit's config: the model that translates the leg's direction, and what it is told. Bing is told nothing:
 * `instructions` is empty for it.
 */
export interface LocalTranslationConfig { modelId: string; instructions: string; wrapTranscript: boolean }

/**
 * How long one job of a model on this machine may take. Longer than the shared default: a model on a slow device
 * can take that long over a long stretch, and its answer is still wanted. Bing keeps the default.
 */
export const LOCAL_MODEL_JOB_TIMEOUT_MS = 60_000;

/** Why this unit cannot translate a direction at all, or null: a source that is not known yet, or a pair Bing does not take. */
export function localTranslationRefusal(modelId: string, source: string, target: string): string | null {
  if (source === AUTO) return 'A translation on this device needs a fixed source language.';
  if (modelId === BING_TRANSLATOR && !(isSupportedByBing(source) && isSupportedByBing(target))) return 'Bing Translator does not support this language pair.';
  return null;
}

/**
 * Starts the translation over one engine from `makeEngine`, which lives as long as the session. `open()` loads
 * the model and rejects when it cannot; nothing is translated before it has.
 */
export function startLocalTranslation(
  makeEngine: () => TranslationLike,
  request: TranslationStartRequest<LocalTranslationConfig, unknown>,
  events: TranslationEvents,
): TranslationSession {
  const { config, clock, signal } = request;
  const { source, target } = request.context.direction;
  let engine: TranslationLike | null = null;
  /** Stopped, failed, or never opened: nothing more is said. */
  let ended = false;
  let opening: Promise<void> | null = null;
  /** While the model loads: rejects the open (the start was cancelled, or the session stopped under it). */
  let failOpening: ((error: unknown) => void) | null = null;

  const frame = (direction: 'in' | 'out', type: string, payload: Record<string, unknown>) => {
    if (!ended) events.frame({ direction, type, payload: framePayload(payload) as Record<string, unknown> });
  };
  const dispose = () => {
    const mine = engine;
    engine = null;
    mine?.dispose();
  };

  const load = (): Promise<void> => new Promise<void>((resolve, reject) => {
    const refusal = localTranslationRefusal(config.modelId, source, target);
    if (refusal) {
      ended = true;
      reject(new AdapterStartError(refusal, 'build_refused'));
      return;
    }
    if (signal.aborted) {
      ended = true;
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    // Stopped before it was ever opened: no engine is made for a session that is over.
    if (ended) {
      reject(new Error('The translation was stopped before its model loaded.'));
      return;
    }
    const mine = makeEngine();
    engine = mine;
    const fail = (error: unknown) => {
      if (!failOpening) return;
      failOpening = null;
      ended = true;
      signal.removeEventListener('abort', onAbort);
      dispose();
      reject(error);
    };
    const onAbort = () => fail(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    failOpening = fail;

    frame('out', 'local.init.translation.start', { model: config.modelId });
    const startedAt = clock.now();
    mine.init(source, target, config.modelId).then(
      () => {
        // Aborted or stopped while the model loaded: it is not wanted, and is already let go.
        if (ended) return;
        try {
          frame('out', 'local.init.translation.ready', { model: config.modelId, initDurationMs: clock.now() - startedAt });
          // A listener of that frame stopped the session: nothing is said after a stop, and the open is already settled.
          if (ended) return;
          events.loading({ stage: 'translation', done: 1, total: 1 });
        } catch (error) {
          // A listener that throws must not leave the open pending: the open fails with it, and the engine is let go.
          fail(error);
          return;
        }
        failOpening = null;
        signal.removeEventListener('abort', onAbort);
        // A failure no request carries: `translate()` would never settle, so the unit ends here.
        mine.onError = (error) => died(`Translation stopped: ${describeCause(error)}`);
        resolve();
      },
      (error: unknown) => {
        if (ended) return;
        const message = describeCause(error);
        try {
          frame('out', 'local.init.translation.error', { model: config.modelId, error: message });
        } catch {
          // The Logs line is the lesser thing: a listener that throws must not keep the open from failing.
        }
        if (isGpuOutOfMemory(message)) fail(new AdapterStartError(GPU_OUT_OF_MEMORY, 'gpu_out_of_memory', undefined, { cause: error }));
        else fail(new Error(`Translation engine init failed: ${message}`));
      },
    );
  });

  const jobs = createJobTranslator({
    events,
    clock,
    signal,
    language: target,
    timeoutMs: config.modelId === BING_TRANSLATOR ? JOB_TIMEOUT_MS : LOCAL_MODEL_JOB_TIMEOUT_MS,
    open: load,
    close: () => {
      // Stopped while the model loaded: the open does not stay pending.
      failOpening?.(new Error('The translation was stopped while its model loaded.'));
      ended = true;
      dispose();
    },
    // No engine here takes a request back: a job given up is left to finish, and its late answer is dropped.
    async translate(text, job) {
      const mine = engine;
      if (!mine) throw new Error('The translation model is not loaded.');
      frame('out', 'local.translation.start', { sourceText: text, modelId: config.modelId, systemPrompt: config.instructions, wrapTranscript: config.wrapTranscript });
      let result: Awaited<ReturnType<TranslationLike['translate']>>;
      try {
        result = await mine.translate(text, config.instructions, config.wrapTranscript);
      } catch (error) {
        if (!job.aborted) frame('in', 'local.pipeline.error', { error: describeCause(error), userMessage: humanizeTranslationError(error) });
        throw error;
      }
      if (!job.aborted) {
        frame('in', 'local.translation.end', {
          sourceText: text,
          translatedText: result.translatedText,
          inferenceTimeMs: result.inferenceTimeMs,
          systemPrompt: result.systemPrompt,
          wrapTranscript: config.wrapTranscript,
          modelId: config.modelId,
        });
      }
      return result.translatedText ?? '';
    },
    failureMessage: (error) => {
      const message = describeCause(error);
      return isDeviceLost(message) ? `The GPU device was lost: ${message}` : humanizeTranslationError(error);
    },
    // Nothing on a lost GPU device will run again.
    fatal: (error) => isDeviceLost(describeCause(error)),
  });

  /** The worker died: the session is let go, whatever it was translating is dropped unsaid, and the unit says it failed. */
  function died(message: string): void {
    if (ended) return;
    // Stopped first, so that nothing of a job in flight follows `failed`.
    void jobs.stop().catch(() => {});
    events.failed({ message });
  }

  return {
    open: () => (opening ??= jobs.open()),
    source: (snapshot) => jobs.source(snapshot),
    stop: () => jobs.stop(),
  };
}
