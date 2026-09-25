import {
  AdapterStartError,
  SAMPLE_RATE,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type Ref,
  type StartRequest,
} from '../../lib/contract/adapter';
import { fillIn, type Punctuator } from '../../lib/conversation/fillIn';
import type { ClientDiagnosticCode } from '../../lib/diagnostics/clientDiagnostics';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { redact } from '../../lib/diagnostics/redact';
import type { TranslationResult } from '../../lib/local-inference/engine/TranslationEngine';
import { gateChars } from '../../lib/segmentation/SentenceStream';
import { DEFAULT_CHUNK_SENTENCES } from '../../lib/segmentation/segmentationMode';
import { defaultEngines, type AsrLike, type LocalEngines, type TranslationLike, type TtsLike, type TtsReady } from './engines';
import { speakTranslation } from './speech';
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

/** A lost WebGPU device: nothing on this GPU will run again. */
function isDeviceLost(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('a valid external instance reference no longer exists') || (lower.includes('webgpu') && lower.includes('device lost'));
}

/**
 * A GPU out-of-memory failure from ONNX Runtime's WebGPU / Vulkan backend
 * (today's detection, `LocalInferenceClient.ts` ~52-61), which counts a lost
 * device too: error messages cascade through several stages, and these are
 * the most distinctive patterns.
 */
function isGpuOutOfMemory(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('out_of_device_memory') || lower.includes('out of memory') || isDeviceLost(message);
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
  /** `translation_unavailable` at most once per session (ruling 5), and only
   *  for a transcription-only one: the start's own notice, or its first
   *  `appendText` — never both. */
  private translationUnavailableAnnounced = false;

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
          tts.onFatal = (error) => this.ttsDied(tts, error);
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
              fail(new AdapterStartError(GPU_OUT_OF_MEMORY, 'gpu_out_of_memory', undefined, { cause: error }));
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
    if (this.config.translation.kind === 'none') this.announceTranslationUnavailable();
  }

  /** Said once per transcription-only session: at the start, or on the first `appendText` it gets. */
  private announceTranslationUnavailable(): void {
    if (this.translationUnavailableAnnounced) return;
    this.translationUnavailableAnnounced = true;
    const { source, target } = this.request.context.direction;
    this.emit('degraded', {
      code: 'translation_unavailable',
      message: `No translation model for ${source} → ${target} — transcription only.`,
    });
  }

  appendAudio(pcm: Int16Array): void {
    if (this.ended) return;
    // The engine transfers the buffer to its worker, and the runner hands this same array to others.
    this.asr.feedAudio(pcm.slice(), SAMPLE_RATE);
  }

  /**
   * A source segment with exactly the typed text (ruling 5: today trims it,
   * this contract does not), then a job as for an ASR final — whose text is
   * trimmed, as every ASR job's is. Text that is blank once trimmed is
   * ignored, as today. An AST or transcription-only session has no engine to
   * hand the text to: the source segment only. Transcription-only says
   * `translation_unavailable` once (never twice with the start's own
   * notice); AST says nothing — that notice says speech is transcribed only,
   * and AST's speech is translated.
   */
  appendText(text: string): void {
    if (this.ended || !text.trim()) return;
    const ref = this.nextRef++;
    const origin = this.nextOrigin();
    this.emit('segmentOpened', { ref, side: 'source', origin });
    this.emit('segmentText', { ref, text });
    this.emit('segmentClosed', { ref, origin });
    const { kind } = this.config.translation;
    if (kind === 'engine') {
      this.enqueue({ text: text.trim(), origin });
    } else if (kind === 'none') {
      this.announceTranslationUnavailable();
    }
  }

  beginTurn(): void {}
  /** No worker can discard a VAD segment or acknowledge a flush (ruling 5): both end a turn the same way. */
  endTurn(): void { this.flushTurn(); }
  cancelTurn(): void { this.flushTurn(); }

  /** Today's manual-turn release: a 700 ms zero tail (seven 100 ms frames at 24 kHz), then flush. */
  private flushTurn(): void {
    if (this.ended) return;
    for (let i = 0; i < 7; i++) this.asr.feedAudio(new Int16Array(2400), SAMPLE_RATE);
    this.asr.flush();
  }

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
      // The worker gave up on this utterance (the streaming one resets and
      // starts over): close its segment with the text it has, or the next
      // utterance's partials would take over its ref.
      this.abandonUtterance();
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
    if (!text) {
      this.abandonUtterance();
      return;
    }
    const current = this.utterance;
    this.utterance = null;
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

  /** Closes the open source segment with the text it has, and queues nothing for it. */
  private abandonUtterance(): void {
    const current = this.utterance;
    this.utterance = null;
    if (current) this.emit('segmentClosed', { ref: current.ref, origin: current.origin });
  }

  private nextOrigin(): string {
    return `u${++this.utterances}`;
  }

  private enqueue(job: Job): void {
    this.jobs.push(job);
    if (!this.processing) void this.drain();
  }

  /**
   * Serial: a job translates and speaks before the next one translates
   * (today's queue). `run` never rejects, and `processing` resets whatever
   * happens, so nothing wedges the queue.
   */
  private async drain(): Promise<void> {
    this.processing = true;
    try {
      while (this.jobs.length > 0 && !this.ended) {
        await this.run(this.jobs.shift()!);
      }
    } finally {
      this.processing = false;
    }
  }

  /** One job: its translation segment opens, carries the text, is spoken, and closes. A failure costs this job only. */
  private async run(job: Job): Promise<void> {
    try {
      const text = await this.translated(job);
      if (text === undefined || this.ended) return;
      const ref = this.nextRef++;
      this.emit('segmentOpened', { ref, side: 'translation', origin: job.origin });
      try {
        this.emit('segmentText', { ref, text });
        await this.speak(ref, text);
      } finally {
        this.emit('segmentClosed', { ref, origin: job.origin });
      }
    } catch (error) {
      // Not the translation (that one is translation_failed): speech, or an
      // event handler that threw. Said in the Logs, and the queue moves on.
      this.frame('in', 'local.pipeline.error', { error: describeCause(error) });
    }
  }

  /**
   * The job's translation — the engine's answer, or the AST final as it is —
   * or undefined when there is nothing to show: an empty answer (the source
   * stays unpaired), a failed one (`translation_failed`), or a session that
   * ended meanwhile.
   */
  private async translated(job: Job): Promise<string | undefined> {
    const { translation } = this;
    const tr = this.config.translation;
    if (!translation || tr.kind !== 'engine') return job.text;
    // A ternary, not a call unconditionally awaited: with punctuation off (the
    // common case) this takes no `await` at all, so `translation.translate()`
    // below still runs in the same microtask as the job's enqueue — every
    // existing synchronous assertion on `translation.calls` still holds.
    const { punctuate } = this.request;
    const text = this.config.punctuateJobs && punctuate ? await this.punctuate(job.text, punctuate) : job.text;
    if (this.ended) return undefined; // stop() while the punctuation budget ran
    this.frame('out', 'local.translation.start', {
      sourceText: text,
      modelId: tr.modelId,
      systemPrompt: tr.instructions,
      wrapTranscript: tr.wrapTranscript,
    });
    let result: TranslationResult;
    try {
      result = await translation.translate(text, tr.instructions, tr.wrapTranscript);
    } catch (error) {
      if (this.ended) return undefined; // disposed by stop(): expected, not a failure
      const message = error instanceof Error ? error.message : String(error);
      const userMessage = humanizeTranslationError(error);
      this.frame('in', 'local.pipeline.error', { error: message, userMessage });
      if (isDeviceLost(message)) { this.fatal(`The GPU device was lost: ${message}`); return undefined; }
      this.emit('degraded', { code: 'translation_failed', message: userMessage, cause: error });
      return undefined;
    }
    if (this.ended || !result.translatedText) return undefined;
    this.frame('in', 'local.translation.end', {
      sourceText: text,
      translatedText: result.translatedText,
      inferenceTimeMs: result.inferenceTimeMs,
      systemPrompt: result.systemPrompt,
      wrapTranscript: tr.wrapTranscript,
      modelId: tr.modelId,
    });
    return result.translatedText;
  }

  /**
   * The job's text as handed to the translation engine, once the caller has
   * already checked `config.punctuateJobs` and a punctuator is installed
   * (ruling: "Punctuated jobs"). Today's Auto shape (`punctuateDefinite`):
   * a text shorter than three sentences' worth of the source language
   * (`gateChars`) goes raw, without asking the model; a longer one goes
   * through `fillIn` — which leaves text that already ends a sentence
   * untouched and discards an answer that alters letters or digits — raced
   * against a 1 s budget on the request's clock; the raw text on timeout.
   * The source segment's own display text is untouched either way: L1
   * punctuates it for display.
   */
  private async punctuate(text: string, punctuator: Punctuator): Promise<string> {
    const { source } = this.request.context.direction;
    if (text.length < gateChars(source, DEFAULT_CHUNK_SENTENCES)) return text;
    return new Promise<string>((resolve) => {
      let settled = false;
      const cancel = this.request.clock.setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(text);
      }, 1000);
      fillIn(source, text, punctuator).then((filled) => {
        if (settled) return;
        settled = true;
        cancel();
        resolve(filled);
      });
    });
  }

  /**
   * Speaks a job's translation into its segment; the segment closes after it
   * resolves (ruling 8), so a range computed on the pre-fill-in text still
   * lands once L1's re-anchor runs. Nothing to say without TTS, or when this
   * leg does not speak — the conformance rule forbids audio then regardless
   * of what `config.tts` carries. A TTS worker that dies meanwhile
   * (`ttsDied`) rejects the sentence it was synthesizing, and the speech
   * ends there: no later sentence is asked for, and the rejected one says
   * nothing more than the death already did.
   */
  private async speak(ref: Ref, text: string): Promise<void> {
    const { tts } = this;
    const ttsConfig = this.config.tts;
    if (!tts || !ttsConfig || !this.request.context.speech) return;
    await speakTranslation(
      tts,
      text,
      this.request.context.direction.target,
      ttsConfig,
      {
        audio: (pcm, range) => this.emit('audio', { ref, pcm, range }),
        degraded: (message, cause) => {
          if (this.tts === tts) this.emit('degraded', { code: 'tts_degraded', message, cause });
        },
        frame: (direction, type, payload) => this.frame(direction, type, payload),
      },
      () => this.ended || this.tts !== tts,
      this.request.clock,
    );
  }

  /**
   * The TTS worker died. A lost GPU device ends the session, as on any
   * engine; otherwise speech stops for the session and the text goes on —
   * the same as TTS failing to load: `tts_degraded`, held until the start
   * resolves when it dies while other engines still load.
   */
  private ttsDied(tts: TtsLike, error: string): void {
    if (this.ended || this.tts !== tts) return;
    if (isDeviceLost(error)) { this.fatal(`The GPU device was lost: ${error}`); return; }
    this.tts = null;
    tts.dispose();
    const notice = { code: 'tts_degraded' as const, message: `Speech synthesis stopped: ${error}` };
    if (this.live) this.emit('degraded', notice);
    else this.notices.push(notice);
  }

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
