/**
 * One session of Local Native's translation as a unit that only translates: the sidecar's translate socket behind
 * the translation contract. It is handed another unit's source text; the shared cutter decides which stretches are
 * sent (`jobTranslator`), and each answer is one translation segment, whole and final: the sidecar's partials are not
 * shown (#578 ruling 21).
 *
 * The model is loaded for the leg's one direction when the session opens, told which other models the line-up loads
 * beside it, and a model that does not load is the start's failure. One job failing costs that job; the socket going
 * away ends the session (#578 ruling 10).
 */
import { AdapterStartError } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import { framePayload } from '../../lib/contract/framePayload';
import type { TranslationEvents, TranslationSession, TranslationStartRequest } from '../../lib/contract/translation';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { AUTO } from '../../lib/language/code';
import type { NativeDevice } from '../../lib/local-inference/native/nativeCatalog';
import type { NativeHost } from '../../lib/local-inference/native/nativeModels';
import { createJobTranslator } from '../../lib/translation/jobTranslator';
import type { NativeTranslationLike } from './engines';

/** The unit's config: the model for the leg's direction, its device and quant, what it is told, and what loads beside it. */
export interface NativeTranslationConfig {
  modelId: string;
  variant?: string;
  device: NativeDevice;
  instructions: string;
  wrapTranscript: boolean;
  /** The other models the line-up loads in the engine, so its memory budget counts them (#578 ruling 22). */
  coLoaded: { asrModel?: string; ttsModel?: string };
  host: NativeHost;
}

/** How long one job may take: a model on a slow device can take that long over a long stretch, and its answer is still wanted. */
export const NATIVE_JOB_TIMEOUT_MS = 60_000;

/** Starts the translation over one socket from `makeEngine`, made on the request's clock when the session opens (#578 ruling 23). */
export function startNativeTranslation(
  makeEngine: (clock: Clock) => NativeTranslationLike,
  request: TranslationStartRequest<NativeTranslationConfig, unknown>,
  events: TranslationEvents,
): TranslationSession {
  const { config, clock, signal } = request;
  const { source, target } = request.context.direction;
  let engine: NativeTranslationLike | null = null;
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
    if (source === AUTO) {
      ended = true;
      reject(new AdapterStartError('A translation in the local engine needs a fixed source language.', 'build_refused'));
      return;
    }
    if (signal.aborted) {
      ended = true;
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    if (ended) {
      reject(new Error('The translation was stopped before its model loaded.'));
      return;
    }
    const mine = makeEngine(clock);
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
    // No partials: each job's answer is one final segment (#578 ruling 21).
    mine.onPartial = null;
    frame('out', 'local.native.init.translation.start', { model: config.modelId, device: config.device, ...config.coLoaded });
    const startedAt = clock.now();
    mine.init({ sourceLang: source, targetLang: target, modelId: config.modelId, device: config.device, variant: config.variant, ...config.coLoaded }).then(
      (report) => {
        if (ended) return;
        try {
          config.host.plan('translation', { ...report, model: config.modelId, device: report.device ?? config.device });
          frame('in', 'local.native.init.translation.ready', { model: config.modelId, initDurationMs: clock.now() - startedAt, ...report });
          if (ended) return;
          events.loading({ stage: 'translation', done: 1, total: 1 });
        } catch (error) {
          fail(error);
          return;
        }
        failOpening = null;
        signal.removeEventListener('abort', onAbort);
        // An id-less error push: one request failed in the sidecar, the session goes on.
        mine.onError = (message) => frame('in', 'local.native.translation.error', { error: message });
        // The socket went away unasked: nothing more will be answered (#578 ruling 10).
        mine.onClosed = (message) => died(`The local engine stopped: ${message}`);
        resolve();
      },
      (error: unknown) => {
        if (ended) return;
        const message = describeCause(error);
        try {
          frame('in', 'local.native.init.translation.error', { model: config.modelId, error: message });
        } catch {
          // The Logs line is the lesser thing: a listener that throws must not keep the open from failing.
        }
        fail(new Error(`Translation engine init failed: ${message}`));
      },
    );
  });

  const jobs = createJobTranslator({
    events,
    clock,
    signal,
    language: target,
    timeoutMs: NATIVE_JOB_TIMEOUT_MS,
    open: load,
    close: () => {
      failOpening?.(new Error('The translation was stopped while its model loaded.'));
      ended = true;
      dispose();
    },
    // The sidecar takes no request back: a job given up is left to finish, and its late answer is dropped.
    async translate(text, job) {
      const mine = engine;
      if (!mine) throw new Error('The translation model is not loaded.');
      frame('out', 'local.native.translation.start', { sourceText: text, modelId: config.modelId, systemPrompt: config.instructions, wrapTranscript: config.wrapTranscript });
      const result = await mine.translate(text, config.instructions, config.wrapTranscript);
      if (!job.aborted) {
        frame('in', 'local.native.translation.end', { sourceText: text, translatedText: result.translatedText, inferenceTimeMs: result.inferenceTimeMs, modelId: config.modelId });
      }
      return result.translatedText ?? '';
    },
  });

  /** The socket went away: the session is let go, whatever it was translating is dropped unsaid, and the unit says it failed. */
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
