import {
  AdapterStartError,
  SAMPLE_RATE,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type Ref,
  type StartRequest,
} from '../../lib/contract/adapter';
import type { ClientDiagnosticCode } from '../../lib/diagnostics/clientDiagnostics';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { redact } from '../../lib/diagnostics/redact';
import type { TranslationResult } from '../../lib/local-inference/engine/TranslationEngine';
import { defaultEngines, type AsrLike, type LocalEngines, type TranslationLike, type TtsLike, type TtsReady } from './engines';
import type { LocalInferenceConfig } from './config';

/**
 * LocalInference on the new contract (spec: "L0 — the client contract"): ASR,
 * translation and TTS in web workers, ported from `LocalInferenceClient`
 * (`src/services/clients/LocalInferenceClient.ts`) without its display
 * bookkeeping — items, statuses, audio segments and write lanes are L1/L2's
 * now. What stays is the pipeline: which engines load, source segments from
 * the ASR's partials and finals, and one serial translation job per final.
 */

export type LocalCredentials = Record<string, never>;

type Stage = 'asr' | 'translation' | 'tts';

/** One translation job: an utterance's text, and the origin pairing its two segments. */
interface Job {
  text: string;
  origin: string;
}

/** Worded as today's `errors.gpuOutOfMemory`; surfaces put `gpu_out_of_memory` into words by code. */
const GPU_OUT_OF_MEMORY = 'GPU out of memory — the selected model is too large for your GPU. Please switch to a smaller model.';

/**
 * A GPU out-of-memory failure from ONNX Runtime's WebGPU / Vulkan backend
 * (today's detection, `LocalInferenceClient.ts` ~52-61). Error messages
 * cascade through several stages; these are the most distinctive patterns.
 */
function isGpuOutOfMemory(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('out_of_device_memory') ||
    lower.includes('out of memory') ||
    lower.includes('a valid external instance reference no longer exists') ||
    (lower.includes('webgpu') && lower.includes('device lost'))
  );
}

/** The device-lost half of that detection: nothing on this GPU will run again. */
function isDeviceLost(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('a valid external instance reference no longer exists') || (lower.includes('webgpu') && lower.includes('device lost'));
}

/**
 * The Bing worker prefixes its errors with a tag (`[bing:token]`,
 * `[bing:network]`, …; `bing-translation.worker.ts`): peel it off into a
 * sentence. Untagged errors keep their own message. Today's
 * `humanizeTranslationError` (`LocalInferenceClient.ts` ~1406-1437).
 */
const BING_ERROR_MESSAGES: Record<string, string> = {
  token: 'Bing Translator could not connect. Check your network and try again.',
  unsupported: 'Bing Translator does not support this language pair.',
  network: 'Bing Translator is temporarily unavailable.',
};

function humanizeTranslationError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (!raw) return 'Translation failed.';
  const match = raw.match(/^\[bing:(token|unsupported|network|unknown)\]\s*(.*)$/);
  if (match) {
    const known = BING_ERROR_MESSAGES[match[1]];
    if (known) return known;
    // 'unknown': keep the detail, still marked as Bing's.
    return match[2] ? `Bing Translator failed: ${match[2]}` : 'Bing Translator failed.';
  }
  return raw;
}

/** Below the contract's 2048-character bound on any frame string. */
const FRAME_STRING_MAX = 2000;

/** A frame payload fit for the Logs panel: every string redacted and cut below the bound. */
function framePayload(value: unknown): unknown {
  if (typeof value === 'string') {
    const clean = redact(value);
    return clean.length > FRAME_STRING_MAX ? `${clean.slice(0, FRAME_STRING_MAX)}…` : clean;
  }
  if (Array.isArray(value)) return value.map(framePayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, framePayload(v)]));
  }
  return value;
}

export function createLocalInferenceAdapter(engines: LocalEngines = defaultEngines): Adapter<LocalInferenceConfig, LocalCredentials> {
  return {
    async start(request, events): Promise<AdapterSession> {
      if (request.signal.aborted) throw request.signal.reason ?? new Error('aborted');
      const session = new LocalSession(request, events, engines);
      await session.open();
      // Once the start has resolved: a start that failed owes no notice.
      queueMicrotask(() => session.announce());
      return session;
    },
  };
}

class LocalSession implements AdapterSession {
  readonly info = { transport: 'local' };

  private readonly config: LocalInferenceConfig;
  private readonly asr: AsrLike;
  private readonly translation: TranslationLike | null;
  private tts: TtsLike | null;

  /** Set by `stop()`, `failed`, or a start that did not open: nothing is emitted after it. */
  private ended = false;
  /** Every engine loaded: the session is running. */
  private live = false;
  /** While opening: rejects the start (a worker dying before every engine loaded). */
  private failOpening: ((error: unknown) => void) | null = null;
  /** Notices found while opening, said once the start resolves. */
  private notices: Array<{ code: ClientDiagnosticCode; message: string; cause?: unknown }> = [];

  private nextRef: Ref = 1;
  private utterances = 0;
  /** The source segment of the utterance in progress, opened at its first partial. */
  private utterance: { ref: Ref; origin: string; text: string } | null = null;
  private jobs: Job[] = [];
  private processing = false;

  constructor(
    private readonly request: StartRequest<LocalInferenceConfig, LocalCredentials>,
    private readonly events: AdapterEvents,
    engines: LocalEngines,
  ) {
    this.config = request.config;
    this.asr = engines.asr(this.config.asr);
    this.translation = this.config.translation.kind === 'engine' ? engines.translation() : null;
    this.tts = this.config.tts ? engines.tts() : null;
  }

  /**
   * Loads every engine in parallel. ASR or translation failing rejects the
   * start, everything disposed first; TTS failing leaves the session without
   * speech. The start's signal disposes every engine and rejects at once;
   * an `init()` that resolves after that disposes its engine (ruling 6).
   */
  open(): Promise<void> {
    const { config, request } = this;
    const { source, target } = request.context.direction;
    const inits: Array<{ stage: Stage; model: string; load: () => Promise<unknown>; dispose: () => void; loaded: (result: unknown) => void }> = [];

    inits.push({
      stage: 'asr',
      model: config.asr.modelId,
      load: () => this.asr.init(config.asr.modelId, {
        vadConfig: config.vad,
        language: source,
        translateTo: config.translation.kind === 'ast' ? target : undefined,
      }),
      dispose: () => this.asr.dispose(),
      loaded: () => this.listenToAsr(),
    });
    const { translation } = this;
    if (translation && config.translation.kind === 'engine') {
      const { modelId } = config.translation;
      inits.push({
        stage: 'translation',
        model: modelId,
        load: () => translation.init(source, target, modelId),
        dispose: () => translation.dispose(),
        loaded: () => {
          // A failure no request carries: `translate()` would never settle and the queue would wedge.
          translation.onError = (error) => this.fatal(`Translation stopped: ${error}`);
        },
      });
    }
    const { tts } = this;
    const ttsConfig = config.tts;
    if (tts && ttsConfig) {
      inits.push({
        stage: 'tts',
        model: ttsConfig.modelId,
        load: () => tts.init(ttsConfig.modelId),
        dispose: () => tts.dispose(),
        loaded: (ready) => {
          tts.onFatal = (error) => this.fatal(`Speech synthesis stopped: ${error}`);
          // The worker substitutes its default voice at generate time, so speech still works.
          const { voices } = ready as TtsReady;
          if (voices && voices.length > 0 && !voices.some((v) => v.sid === ttsConfig.speakerId)) {
            this.notices.push({
              code: 'voice_fallback',
              message: `Configured voice ${ttsConfig.speakerId} is not loaded; using the model default. Update the selection in settings.`,
            });
          }
        },
      });
    }

    this.frame('out', 'local.init.start', { engines: inits.map((i) => i.stage) });

    return new Promise<void>((resolve, reject) => {
      const { signal, clock } = request;
      const total = inits.length;
      let done = 0;

      const fail = (error: unknown) => {
        if (this.ended) return;
        this.ended = true;
        this.failOpening = null;
        signal.removeEventListener('abort', onAbort);
        this.disposeEngines();
        reject(error);
      };
      const onAbort = () => fail(signal.reason ?? new Error('aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      this.failOpening = fail;

      const settled = (stage: Stage) => {
        this.emit('loading', { stage, done: ++done, total });
        if (done < total) return;
        signal.removeEventListener('abort', onAbort);
        this.failOpening = null;
        this.live = true;
        this.frame('out', 'local.session.opened', {
          asrModel: config.asr.modelId,
          translationPair: `${source} → ${target}`,
          ttsModel: config.tts?.modelId ?? null,
        });
        resolve();
      };

      for (const init of inits) {
        this.frame('out', `local.init.${init.stage}.start`, { model: init.model });
        const startedAt = clock.now();
        init.load().then(
          (result) => {
            // Aborted or failed while this engine loaded: it is not wanted.
            if (this.ended) { init.dispose(); return; }
            this.frame('out', `local.init.${init.stage}.ready`, { model: init.model, initDurationMs: clock.now() - startedAt });
            init.loaded(result);
            settled(init.stage);
          },
          (error: unknown) => {
            if (this.ended) return;
            const message = describeCause(error);
            this.frame('out', `local.init.${init.stage}.error`, { model: init.model, error: message });
            if (init.stage === 'tts') {
              init.dispose();
              this.tts = null;
              this.notices.push({ code: 'tts_degraded', message: `TTS unavailable, continuing without it: ${message}`, cause: error });
              settled(init.stage);
              return;
            }
            if (isGpuOutOfMemory(message)) {
              fail(new AdapterStartError(GPU_OUT_OF_MEMORY, 'gpu_out_of_memory'));
              return;
            }
            fail(new Error(`${init.stage === 'asr' ? 'ASR' : 'Translation'} engine init failed: ${message}`));
          },
        );
      }
    });
  }

  /** The notices the start found, and transcription-only's own, once the start has resolved. */
  announce(): void {
    for (const notice of this.notices) this.emit('degraded', notice);
    this.notices = [];
    if (this.config.translation.kind === 'none') {
      const { source, target } = this.request.context.direction;
      this.emit('degraded', {
        code: 'translation_unavailable',
        message: `No translation model for ${source} → ${target} — transcription only.`,
      });
    }
  }

  appendAudio(pcm: Int16Array): void {
    if (this.ended) return;
    // The engine transfers the buffer to its worker, and the runner hands this same array to others.
    this.asr.feedAudio(pcm.slice(), SAMPLE_RATE);
  }

  // Typed text and manual turns are not taken yet: typed text will be a
  // source segment with exactly its text, then a job; a turn's end, a silence
  // tail and a flush.
  appendText(): void {}
  beginTurn(): void {}
  endTurn(): void {}
  cancelTurn(): void {}

  async stop(): Promise<void> {
    this.ended = true;
    this.jobs = [];
    this.disposeEngines();
  }

  private disposeEngines(): void {
    this.asr.dispose();
    this.translation?.dispose();
    this.tts?.dispose();
  }

  /** ASR's callbacks, once its engine loaded: before that, its errors reject the start instead. */
  private listenToAsr(): void {
    const { asr } = this;
    asr.onSpeechStart = () => this.frame('in', 'local.asr.start', { modelId: this.config.asr.modelId });
    asr.onPartialResult = (text) => this.partial(text);
    asr.onResult = (result) => this.final(result);
    asr.onError = (error) => {
      this.frame('in', 'local.asr.error', { error });
      if (isDeviceLost(error)) { this.fatal(`The GPU device was lost: ${error}`); return; }
      this.emit('degraded', { code: 'transcription_failed', message: error });
    };
    asr.onFatal = (error) => {
      this.frame('in', 'local.asr.error', { error });
      this.fatal(`Speech recognition stopped: ${error}`);
    };
  }

  /**
   * A partial is the cumulative hypothesis for the utterance. The source
   * segment opens at the first non-empty one — not at speech start: a VAD
   * false start ends in an empty final and would strand a blank segment.
   * Trimmed, or an engine's leading space (cohere, voxtral-3b) would make the
   * final a rewrite rather than a growth of the partials.
   */
  private partial(raw: string): void {
    this.frame('in', 'local.asr.partial', { text: raw });
    if (this.ended || this.config.translation.kind === 'ast') return;
    const text = raw.trim();
    if (!text) return;
    if (!this.utterance) {
      this.utterance = { ref: this.nextRef++, origin: this.nextOrigin(), text: '' };
      this.emit('segmentOpened', { ref: this.utterance.ref, side: 'source', origin: this.utterance.origin });
    }
    if (text === this.utterance.text) return;
    this.utterance.text = text;
    this.emit('segmentText', { ref: this.utterance.ref, text });
  }

  /**
   * The final closes the utterance's source segment (opening it now for an
   * engine that sent no partial) and queues its job. An empty final is
   * dropped, closing a segment its partials opened with its last text. AST:
   * the final already is the translation — no source segment.
   */
  private final(result: { text: string; durationMs: number; recognitionTimeMs: number }): void {
    if (this.ended) return;
    const text = result.text.trim();
    const current = this.utterance;
    this.utterance = null;
    if (!text) {
      if (current) this.emit('segmentClosed', { ref: current.ref, origin: current.origin });
      return;
    }
    this.frame('in', 'local.asr.end', {
      text,
      modelId: this.config.asr.modelId,
      durationMs: result.durationMs,
      recognitionTimeMs: result.recognitionTimeMs,
    });
    const { kind } = this.config.translation;
    if (kind === 'ast') {
      this.enqueue({ text, origin: this.nextOrigin() });
      return;
    }
    const segment = current ?? { ref: this.nextRef++, origin: this.nextOrigin(), text: '' };
    if (!current) this.emit('segmentOpened', { ref: segment.ref, side: 'source', origin: segment.origin });
    if (text !== segment.text) this.emit('segmentText', { ref: segment.ref, text });
    this.emit('segmentClosed', { ref: segment.ref, origin: segment.origin });
    if (kind === 'engine') this.enqueue({ text, origin: segment.origin });
  }

  private nextOrigin(): string {
    return `u${++this.utterances}`;
  }

  private enqueue(job: Job): void {
    this.jobs.push(job);
    if (!this.processing) void this.drain();
  }

  /** Serial: a job translates and speaks before the next one translates (today's queue). */
  private async drain(): Promise<void> {
    this.processing = true;
    while (this.jobs.length > 0 && !this.ended) {
      await this.run(this.jobs.shift()!);
    }
    this.processing = false;
  }

  private async run(job: Job): Promise<void> {
    let text = job.text; // AST: already the translation
    const { translation } = this;
    const tr = this.config.translation;
    if (translation && tr.kind === 'engine') {
      this.frame('out', 'local.translation.start', {
        sourceText: job.text,
        modelId: tr.modelId,
        systemPrompt: tr.instructions,
        wrapTranscript: tr.wrapTranscript,
      });
      let result: TranslationResult;
      try {
        result = await translation.translate(job.text, tr.instructions, tr.wrapTranscript);
      } catch (error) {
        if (this.ended) return; // disposed by stop(): expected, not a failure
        const message = error instanceof Error ? error.message : String(error);
        const userMessage = humanizeTranslationError(error);
        this.frame('in', 'local.pipeline.error', { error: message, userMessage });
        if (isDeviceLost(message)) { this.fatal(`The GPU device was lost: ${message}`); return; }
        this.emit('degraded', { code: 'translation_failed', message: userMessage, cause: error });
        return;
      }
      if (this.ended) return;
      text = result.translatedText;
      if (!text) return; // an empty translation opens nothing; the source stays unpaired
      this.frame('in', 'local.translation.end', {
        sourceText: job.text,
        translatedText: text,
        inferenceTimeMs: result.inferenceTimeMs,
        systemPrompt: result.systemPrompt,
        wrapTranscript: tr.wrapTranscript,
        modelId: tr.modelId,
      });
    }
    const ref = this.nextRef++;
    this.emit('segmentOpened', { ref, side: 'translation', origin: job.origin });
    this.emit('segmentText', { ref, text });
    await this.speak(job, ref, text);
    this.emit('segmentClosed', { ref, origin: job.origin });
  }

  /** Speaks a job's translation into its segment; the segment closes after it resolves. Nothing to say yet. */
  private async speak(_job: Job, _ref: Ref, _text: string): Promise<void> {}

  /** The session can no longer work: while opening, the start rejects; after, `failed`, and nothing more. */
  private fatal(message: string): void {
    if (this.ended) return;
    if (!this.live) {
      this.failOpening?.(new Error(message));
      return;
    }
    this.emit('failed', { message });
    this.ended = true;
  }

  private frame(direction: 'in' | 'out', type: string, payload: Record<string, unknown>): void {
    this.emit('frame', { direction, type, payload: framePayload(payload) });
  }

  private emit<K extends keyof AdapterEvents>(kind: K, payload: Parameters<AdapterEvents[K]>[0]): void {
    if (this.ended) return;
    (this.events[kind] as (p: typeof payload) => void)(payload);
  }
}
