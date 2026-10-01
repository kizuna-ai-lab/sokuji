import {
  SAMPLE_RATE,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type Ref,
  type StartRequest,
} from '../../lib/contract/adapter';
import { framePayload } from '../../lib/contract/framePayload';
import { fillIn, type Punctuator } from '../../lib/conversation/fillIn';
import type { ClientDiagnosticCode } from '../../lib/diagnostics/clientDiagnostics';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { countSkeleton } from '../../lib/segmentation/sealCursor';
import { SentenceCut, runtimeOver } from '../../lib/segmentation/sentenceCut';
import { gateChars, type SealedChunk } from '../../lib/segmentation/SentenceStream';
import { DEFAULT_CHUNK_SENTENCES } from '../../lib/segmentation/segmentationMode';
import type { LocalNativeConfig } from './config';
import type { LocalNativeEngines, NativeAsrLike, NativeInitReport, NativeTranslationLike, NativeTtsLike, NativeTtsReady, NativeVadLike } from './engines';
import type { NativeHost, NativeStage } from './host';
import { speakNative } from './speech';
import { applyVoice, voiceClipMissing } from './voice';

/**
 * Local Native on the new contract (spec: "L0 — the client contract"): ASR,
 * translation and TTS in the Electron sidecar, VAD in a renderer worker,
 * ported from `LocalNativeClient` without its display bookkeeping. Audio goes
 * to the sidecar and the VAD as it arrives (#578 ruling 2); the VAD's edges
 * become the sidecar's marks; source segments come from the sidecar's
 * partials and finals; translation jobs run one at a time, each streaming
 * into its own segment and spoken before the next starts.
 */

export type LocalNativeCredentials = Record<string, never>;

/** The VAD worker's model load: past this, the start fails (the old client's). */
export const VAD_INIT_TIMEOUT_MS = 15_000;
/** A manual turn's release: 700 ms of silence, seven 100 ms frames, before the flush (the old shell's `pttFinalization`). */
const TAIL_FRAMES = 7;
const FRAME_SAMPLES = SAMPLE_RATE / 10;

interface Job {
  text: string;
  origin: string;
  /** Punctuate before translating: a per-final or typed job under a sentences display; never a seal. */
  fill: boolean;
}

/** The translation segment a job fills: opened at its first text. */
interface Answer {
  ref: Ref | null;
  origin: string;
  text: string;
}

export function createLocalNativeAdapter(engines: LocalNativeEngines, host: NativeHost): Adapter<LocalNativeConfig, LocalNativeCredentials> {
  return {
    async start(request, events): Promise<AdapterSession> {
      if (request.signal.aborted) throw request.signal.reason ?? new Error('aborted');
      const session = new NativeSession(request, events, engines, host);
      await session.open();
      // Once the start has resolved: a start that failed owes no notice.
      queueMicrotask(() => session.announce());
      return session;
    },
  };
}

class NativeSession implements AdapterSession {
  readonly info = { transport: 'sidecar' };

  private readonly config: LocalNativeConfig;
  private readonly asr: NativeAsrLike;
  private readonly translation: NativeTranslationLike | null;
  private tts: NativeTtsLike | null;
  private ttsReady: NativeTtsReady | null = null;
  /** The voice applied at load, for the Logs panel. */
  private voiceLabel = '';
  private readonly vad: NativeVadLike;

  /** Set by `stop()`, `failed`, or a start that did not open: nothing is emitted after it. */
  private ended = false;
  private live = false;
  private failOpening: ((error: unknown) => void) | null = null;
  private notices: Array<{ code: ClientDiagnosticCode; message: string; cause?: unknown }> = [];
  private translationUnavailableAnnounced = false;
  private readonly ttsDeath: Promise<void>;
  private ttsDeathSettle: () => void = () => {};

  private nextRef: Ref = 1;
  private utterances = 0;
  private utterance: { ref: Ref; origin: string; text: string } | null = null;
  private jobs: Job[] = [];
  private processing = false;
  /** The running job's translation segment: its partials fill it (one job runs at a time). */
  private answer: Answer | null = null;
  private readonly cut: SentenceCut | null;

  constructor(
    private readonly request: StartRequest<LocalNativeConfig, LocalNativeCredentials>,
    private readonly events: AdapterEvents,
    engines: LocalNativeEngines,
    private readonly host: NativeHost,
  ) {
    this.config = request.config;
    // The VAD first: its worker factory can throw, and nothing is made yet that the throw would leave unended.
    this.vad = engines.vad();
    this.asr = engines.asr();
    this.translation = this.config.translation ? engines.translation() : null;
    this.tts = this.config.tts ? engines.tts() : null;
    this.ttsDeath = new Promise<void>((resolve) => { this.ttsDeathSettle = resolve; });
    const { jobSentences } = this.config;
    const { punctuate } = request;
    this.cut = this.config.translation && jobSentences !== undefined && jobSentences >= 1 && jobSentences <= 5 && punctuate
      ? new SentenceCut({
        lang: request.context.direction.source,
        sentences: jobSentences,
        runtime: runtimeOver(punctuate, request.clock),
        onPending: (tail) => this.show(tail),
        onSeal: (chunk) => this.seal(chunk),
      })
      : null;
  }

  /**
   * Loads ASR and translation in the builder's order (#578 ruling 15), then
   * TTS, then the VAD. ASR, translation or the VAD failing rejects the start,
   * every seam ended first; TTS failing leaves the session without speech
   * (#578 ruling 10). The start's signal ends every seam and rejects at once.
   */
  open(): Promise<void> {
    const { config, request } = this;
    const { source, target } = request.context.direction;
    const total = 1 + (this.translation ? 1 : 0) + (this.tts ? 1 : 0);
    let done = 0;
    this.frame('out', 'local.native.init.start', {
      asr: config.asr.modelId,
      translation: config.translation?.modelId ?? null,
      tts: config.tts?.modelId ?? null,
      sourceLanguage: source,
      targetLanguage: target,
    });
    this.probeHardware();

    return new Promise<void>((resolve, reject) => {
      const { signal } = request;
      const fail = (error: unknown) => {
        if (this.ended) return;
        this.ended = true;
        this.failOpening = null;
        signal.removeEventListener('abort', onAbort);
        this.endSeams();
        reject(error);
      };
      const onAbort = () => fail(signal.reason ?? new Error('aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      this.failOpening = fail;
      const loaded = (stage: NativeStage) => this.emit('loading', { stage, done: ++done, total });
      /** Opening was cut short: what follows is nobody's business. */
      const alive = () => { if (this.ended) throw new Error('ended while opening'); };

      const loadAsr = async () => {
        const startedAt = request.clock.now();
        let report: NativeInitReport;
        try {
          report = await this.asr.init({ language: source, modelId: config.asr.modelId, device: config.asr.device, variant: config.asr.variant });
        } catch (error) {
          throw new Error(`ASR engine init failed: ${describeCause(error)}`);
        }
        alive();
        this.loadedStage('asr', config.asr.modelId, report, request.clock.now() - startedAt);
        this.listenToAsr();
        loaded('asr');
      };
      const loadTranslation = async () => {
        const { translation } = this;
        const tr = config.translation;
        if (!translation || !tr) return;
        const startedAt = request.clock.now();
        let report: NativeInitReport;
        try {
          report = await translation.init({
            sourceLang: source, targetLang: target, modelId: tr.modelId, device: tr.device, variant: tr.variant,
            // Co-loaded stages, so the sidecar accounts for their memory.
            asrModel: config.asr.modelId, ttsModel: config.tts?.modelId,
          });
        } catch (error) {
          throw new Error(`Translation engine init failed: ${describeCause(error)}`);
        }
        alive();
        this.loadedStage('translation', tr.modelId, report, request.clock.now() - startedAt);
        translation.onPartial = (text) => { if (this.answer) this.showAnswer(this.answer, text); };
        translation.onError = (message) => this.emit('degraded', { code: 'translation_failed', message });
        translation.onClosed = (message) => this.fatal(`The local engine stopped: ${message}`);
        loaded('translation');
      };

      const steps = async () => {
        if (config.asrFirst) { await loadAsr(); await loadTranslation(); }
        else { await loadTranslation(); await loadAsr(); }
        await this.loadTts(loaded);
        alive();
        await this.loadVad();
        alive();
      };
      steps().then(() => {
        if (this.ended) return;
        signal.removeEventListener('abort', onAbort);
        this.failOpening = null;
        this.live = true;
        this.frame('out', 'local.native.init.ready', { ttsEnabled: this.tts !== null });
        resolve();
      }, (error: unknown) => fail(error));
    });
  }

  /** A stage's plan: the Logs line, its fallback line, and the library's badge (#578 ruling 14). */
  private loadedStage(stage: NativeStage, model: string, report: NativeInitReport, elapsedMs: number): void {
    const device = report.device ?? 'cpu';
    this.frame('in', `local.native.init.${stage}.ready`, {
      model, device, backend: report.backend, computeType: report.computeType,
      ...(report.rtf !== undefined ? { rtf: report.rtf } : {}),
      ...(report.tokensPerSec !== undefined ? { tokensPerSec: report.tokensPerSec } : {}),
      ...(report.memoryBytes !== undefined ? { memoryBytes: report.memoryBytes } : {}),
      loadTimeMs: report.loadTimeMs ?? elapsedMs,
    });
    if (report.fallbackReason) this.frame('in', `local.native.init.${stage}.fallback`, { model, fallbackReason: report.fallbackReason });
    this.host.plan(stage, { ...report, model, device });
  }

  /** TTS, unless the model cannot speak without a clip the device lacks; failing, the session goes on without speech. */
  private async loadTts(loaded: (stage: NativeStage) => void): Promise<void> {
    const { tts } = this;
    const ttsConfig = this.config.tts;
    if (!tts || !ttsConfig) return;
    const { target } = this.request.context.direction;
    if (await voiceClipMissing(ttsConfig, this.host)) {
      if (this.ended) return;
      this.dropTts(tts);
      this.notices.push({ code: 'tts_degraded', message: `TTS unavailable, continuing without it: "${ttsConfig.modelId}" needs a voice clip — record or import one in Settings first` });
      loaded('tts');
      return;
    }
    if (this.ended) return;
    const startedAt = this.request.clock.now();
    try {
      const ready = await tts.init({ modelId: ttsConfig.modelId, device: ttsConfig.device, language: target, variant: ttsConfig.variant });
      if (this.ended) return;
      this.loadedStage('tts', ttsConfig.modelId, ready, this.request.clock.now() - startedAt);
      const applied = await applyVoice(tts, ttsConfig, target, ready, this.host);
      if (this.ended) return;
      this.ttsReady = ready;
      this.voiceLabel = applied.voice;
      if (applied.substituted) {
        this.notices.push({
          code: 'voice_fallback',
          message: `Configured voice ${applied.substituted.from} is no longer usable with this model (deleted, or missing a required transcript); substituted voice ${applied.substituted.to}. Update the selection in settings.`,
        });
      }
      tts.onError = (message) => this.emit('degraded', { code: 'tts_degraded', message });
      tts.onClosed = (message) => this.ttsDied(tts, message);
    } catch (error) {
      if (this.ended) return;
      this.frame('in', 'local.native.init.tts.error', { model: ttsConfig.modelId, error: describeCause(error) });
      this.dropTts(tts);
      this.notices.push({ code: 'tts_degraded', message: `TTS unavailable, continuing without it: ${describeCause(error)}`, cause: error });
    }
    loaded('tts');
  }

  /** The VAD worker, bounded by the request's clock; its edges become the sidecar's marks. */
  private loadVad(): Promise<void> {
    const { vad, request } = this;
    vad.onSpeechStart = () => {
      if (this.ended) return;
      this.asr.sendVadMark('start');
      this.frame('out', 'local.native.speech_start', {});
    };
    vad.onSpeechEnd = () => { if (!this.ended) this.asr.sendVadMark('end'); };
    vad.onSpeechCancel = () => { if (!this.ended) this.asr.sendVadMark('cancel'); };
    vad.onError = (message) => this.fatal(`Voice activity detection stopped: ${message}`);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cancel = request.clock.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('VAD worker init timeout'));
      }, VAD_INIT_TIMEOUT_MS);
      vad.init(this.config.vad).then(
        () => { if (settled) return; settled = true; cancel(); resolve(); },
        (error: unknown) => { if (settled) return; settled = true; cancel(); reject(error); },
      );
    });
  }

  /** A machine snapshot for the Logs panel, never on the start's path. */
  private probeHardware(): void {
    this.host.hardware().then((hw) => {
      if (!hw) return;
      this.frame('in', 'local.native.hardware', {
        os: hw.os, arch: hw.arch, cpuCores: hw.cpuCores, gpus: hw.gpus,
        backendsInstalled: hw.backendsInstalled, accelAvailable: hw.accelAvailable,
        generation: hw.generation ?? null, devices: hw.devices ?? null,
      });
    }, () => { /* diagnostics only */ });
  }

  /** The notices the start found, and transcription-only's own, once the start has resolved. */
  announce(): void {
    for (const notice of this.notices) this.emit('degraded', notice);
    this.notices = [];
    if (!this.config.translation) this.announceTranslationUnavailable();
  }

  private announceTranslationUnavailable(): void {
    if (this.translationUnavailableAnnounced) return;
    this.translationUnavailableAnnounced = true;
    const { source, target } = this.request.context.direction;
    this.emit('degraded', { code: 'translation_unavailable', message: `No translation model for ${source} → ${target} — transcription only.` });
  }

  appendAudio(pcm: Int16Array): void {
    if (this.ended) return;
    // Both copy what they are handed (the socket, the worker's structured clone): the runner may reuse the array.
    this.asr.feedAudio(pcm);
    this.vad.feed(pcm);
  }

  /** As LocalInference's: a source segment with exactly the typed text, then a job with its trimmed text. */
  appendText(text: string): void {
    if (this.ended || !text.trim()) return;
    const ref = this.nextRef++;
    const origin = this.nextOrigin();
    this.emit('segmentOpened', { ref, side: 'source', origin });
    this.emit('segmentText', { ref, text });
    this.emit('segmentClosed', { ref, origin });
    if (this.config.translation) this.enqueue({ text: text.trim(), origin, fill: this.config.jobSentences !== undefined });
    else this.announceTranslationUnavailable();
  }

  beginTurn(): void {}
  /** Neither the VAD nor the sidecar can discard a segment: both end a turn the same way. */
  endTurn(): void { this.flushTurn(); }
  cancelTurn(): void { this.flushTurn(); }

  /** The silent tail, then the VAD's flush and the sidecar's (the old `createResponse`); a failed flush costs nothing but a Logs line. */
  private flushTurn(): void {
    if (this.ended) return;
    const silence = new Int16Array(FRAME_SAMPLES);
    for (let i = 0; i < TAIL_FRAMES; i++) {
      this.asr.feedAudio(silence);
      this.vad.feed(silence);
    }
    this.vad.flush();
    this.asr.flush().catch((error: unknown) => this.frame('in', 'local.native.asr.flush.error', { error: describeCause(error) }));
  }

  async stop(): Promise<void> {
    this.ended = true;
    this.jobs = [];
    this.cut?.reset();
    this.endSeams();
  }

  private endSeams(): void {
    this.vad.dispose();
    this.asr.dispose();
    this.translation?.dispose();
    this.tts?.dispose();
  }

  private listenToAsr(): void {
    const { asr } = this;
    asr.onPartialResult = (text) => this.partial(text);
    asr.onResult = (result) => this.final(result);
    asr.onError = (error) => {
      this.frame('in', 'local.native.asr.error', { error });
      // One chunk failed (#578 ruling 10): close what the utterance showed, and drop its cut.
      this.abandonUtterance();
      this.cut?.reset();
      this.emit('degraded', { code: 'transcription_failed', message: error });
    };
    asr.onClosed = (message) => this.fatal(`The local engine stopped: ${message}`);
  }

  /** The sidecar's cumulative hypothesis for the utterance: shown, or sliced by the cut. */
  private partial(raw: string): void {
    if (!raw || this.ended) return;
    this.frame('in', 'local.native.asr.partial', { text: raw });
    if (this.cut) this.cut.partial(raw);
    else this.show(raw);
  }

  /** LocalInference's rule: the open source segment opens at the first text holding a letter or digit. */
  private show(raw: string): void {
    const text = raw.trim();
    if (countSkeleton(text) === 0) return;
    if (!this.utterance) {
      this.utterance = { ref: this.nextRef++, origin: this.nextOrigin(), text: '' };
      this.emit('segmentOpened', { ref: this.utterance.ref, side: 'source', origin: this.utterance.origin });
    }
    if (text === this.utterance.text) return;
    this.utterance.text = text;
    this.emit('segmentText', { ref: this.utterance.ref, text });
  }

  /** A chunk the cut sealed: its segment closes and its job is queued; never filled in. */
  private seal({ text, reason }: SealedChunk): void {
    this.frame('out', 'local.native.segmentation.seal', { reason, text });
    const sealed = text.trim();
    if (countSkeleton(sealed) === 0) return;
    this.show(sealed);
    const segment = this.utterance!;
    this.utterance = null;
    this.emit('segmentClosed', { ref: segment.ref, origin: segment.origin });
    this.enqueue({ text: sealed, origin: segment.origin, fill: false });
  }

  private final(result: { text: string; durationMs: number; recognitionTimeMs: number }): void {
    if (this.ended) return;
    const text = result.text.trim();
    if (!text) {
      this.cut?.reset();
      this.abandonUtterance();
      return;
    }
    this.frame('in', 'local.native.asr.end', {
      text,
      modelId: this.config.asr.modelId,
      durationMs: result.durationMs,
      recognitionTimeMs: result.recognitionTimeMs,
      ...(result.durationMs > 0 ? { rtf: Math.round((result.recognitionTimeMs / result.durationMs) * 1000) / 1000 } : {}),
    });
    if (this.cut) {
      this.cut.final(text);
      this.abandonUtterance();
      return;
    }
    const current = this.utterance;
    this.utterance = null;
    const segment = current ?? { ref: this.nextRef++, origin: this.nextOrigin(), text: '' };
    if (!current) this.emit('segmentOpened', { ref: segment.ref, side: 'source', origin: segment.origin });
    if (text !== segment.text) this.emit('segmentText', { ref: segment.ref, text });
    this.emit('segmentClosed', { ref: segment.ref, origin: segment.origin });
    if (this.config.translation) this.enqueue({ text, origin: segment.origin, fill: this.config.jobSentences !== undefined });
  }

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

  private async drain(): Promise<void> {
    this.processing = true;
    try {
      while (this.jobs.length > 0 && !this.ended) await this.run(this.jobs.shift()!);
    } finally {
      this.processing = false;
    }
  }

  /** One job: its translation streams into its segment, is spoken, and the segment closes — after a failure, with what streamed (#578 ruling 8). */
  private async run(job: Job): Promise<void> {
    const answer: Answer = { ref: null, origin: job.origin, text: '' };
    this.answer = answer;
    try {
      const text = await this.translated(job);
      if (text === undefined || this.ended) return;
      this.showAnswer(answer, text);
      if (answer.ref !== null) await this.speak(answer.ref, text);
    } catch (error) {
      this.frame('in', 'local.native.pipeline.error', { error: describeCause(error) });
    } finally {
      this.answer = null;
      if (answer.ref !== null) this.emit('segmentClosed', { ref: answer.ref, origin: answer.origin });
    }
  }

  /** The job's translation segment opens at its first text and shows each new one. */
  private showAnswer(answer: Answer, text: string): void {
    if (!text || this.ended) return;
    if (answer.ref === null) {
      answer.ref = this.nextRef++;
      this.emit('segmentOpened', { ref: answer.ref, side: 'translation', origin: answer.origin });
    }
    if (text === answer.text) return;
    answer.text = text;
    this.emit('segmentText', { ref: answer.ref, text });
  }

  private async translated(job: Job): Promise<string | undefined> {
    const { translation } = this;
    const tr = this.config.translation;
    if (!translation || !tr) return undefined;
    const { punctuate } = this.request;
    const text = job.fill && punctuate ? await this.punctuate(job.text, punctuate) : job.text;
    if (this.ended) return undefined;
    this.frame('out', 'local.native.translation.start', { sourceText: text, modelId: tr.modelId, systemPrompt: tr.instructions, wrapTranscript: tr.wrapTranscript });
    let result: { translatedText: string; inferenceTimeMs: number };
    try {
      result = await translation.translate(text, tr.instructions, tr.wrapTranscript);
    } catch (error) {
      if (this.ended) return undefined;
      const message = describeCause(error);
      this.frame('in', 'local.native.translation.error', { modelId: tr.modelId, sourceText: text, error: message });
      this.emit('degraded', { code: 'translation_failed', message, cause: error });
      return undefined;
    }
    if (this.ended || !result.translatedText) return undefined;
    this.frame('in', 'local.native.translation.end', { sourceText: text, translatedText: result.translatedText, inferenceTimeMs: result.inferenceTimeMs, modelId: tr.modelId });
    return result.translatedText;
  }

  /** LocalInference's Auto shape: short text raw; longer text filled in within 1 s on the request's clock, else raw. */
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

  /** Speaks into the job's segment; a TTS that dies meanwhile ends the speech at once (`ttsDeath` wins the race). */
  private async speak(ref: Ref, text: string): Promise<void> {
    const { tts, ttsReady } = this;
    const ttsConfig = this.config.tts;
    if (!tts || !ttsReady || !ttsConfig || !this.request.context.speech) return;
    const spoken = speakNative(
      tts,
      text,
      this.request.context.direction.target,
      { modelId: ttsConfig.modelId, voice: this.voiceLabel, speed: ttsConfig.speed, streaming: ttsReady.streaming },
      {
        audio: (pcm, range) => this.emit('audio', { ref, pcm, range }),
        ranges: (entries) => this.emit('speechRanges', { ref, ranges: entries }),
        degraded: (message, cause) => this.emit('degraded', { code: 'tts_degraded', message, cause }),
        frame: (direction, type, payload) => this.frame(direction, type, payload),
      },
      () => this.ended || this.tts !== tts,
      this.request.clock,
    );
    await Promise.race([spoken, this.ttsDeath]);
  }

  private dropTts(tts: NativeTtsLike): void {
    tts.dispose();
    if (this.tts === tts) this.tts = null;
  }

  /** The TTS socket closed: speech stops for the session and the text goes on (#578 ruling 10). */
  private ttsDied(tts: NativeTtsLike, error: string): void {
    if (this.ended || this.tts !== tts) return;
    this.dropTts(tts);
    this.ttsDeathSettle();
    const notice = { code: 'tts_degraded' as const, message: `Speech synthesis stopped: ${error}` };
    if (this.live) this.emit('degraded', notice);
    else this.notices.push(notice);
  }

  /** The session can no longer work: while opening, the start rejects; after, `failed`, and nothing more. */
  private fatal(message: string): void {
    if (this.ended) return;
    this.cut?.reset();
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
