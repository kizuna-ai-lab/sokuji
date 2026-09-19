/**
 * LocalInferenceClient — IClient implementation for fully offline
 * ASR → Translation → TTS pipeline using sherpa-onnx WASM engines.
 *
 * Audio flow:
 *   Mic (Int16@24kHz) → AsrEngine → text → TranslationEngine → translated text
 *   → TtsEngine → Float32@modelRate → resample → Int16@24kHz → speaker
 */

import {
  IClient,
  ConversationItem,
  SessionConfig,
  LocalInferenceSessionConfig,
  isLocalInferenceSessionConfig,
  ClientEventHandlers,
  ResponseConfig,
} from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';
import { AsrEngine } from '../../lib/local-inference/engine/AsrEngine';
import { StreamingAsrEngine } from '../../lib/local-inference/engine/StreamingAsrEngine';
import { TranslationEngine } from '../../lib/local-inference/engine/TranslationEngine';
import { TtsEngine } from '../../lib/local-inference/engine/TtsEngine';
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { resampleFloat32, float32ToInt16 } from '../../utils/audio-conversion';
import { splitSentences } from '../../utils/splitSentences';
import i18n from '../../locales';
import type { ClientDiagnosticCode } from '../../lib/diagnostics/clientDiagnostics';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { SentenceStream } from '../../lib/segmentation/SentenceStream';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';

/**
 * Error thrown when GPU runs out of memory during WebGPU model initialization.
 * Carries a user-friendly translated message and a stable `isGpuOom` flag so
 * callers can detect it without parsing translated strings.
 */
export class GpuOutOfMemoryError extends Error {
  readonly isGpuOom = true;
  constructor(message: string) {
    super(message);
    this.name = 'GpuOutOfMemoryError';
  }
}

/**
 * Detect GPU out-of-memory errors from ONNX Runtime WebGPU / Vulkan backend.
 * Error messages cascade through several stages; we check the most distinctive patterns.
 */
function isGpuOutOfMemoryError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  return (
    lower.includes('out_of_device_memory') ||
    lower.includes('out of memory') ||
    lower.includes('a valid external instance reference no longer exists') ||
    (lower.includes('webgpu') && lower.includes('device lost'))
  );
}

interface AsrTiming {
  durationMs: number;
  recognitionTimeMs: number;
}

interface PipelineJob {
  text: string;
  asrTiming?: AsrTiming;
}

export class LocalInferenceClient implements IClient {
  private asrEngine: AsrEngine | StreamingAsrEngine | null = null;
  private translationEngine: TranslationEngine | null = null;
  private ttsEngine: TtsEngine | null = null;

  private config: LocalInferenceSessionConfig | null = null;
  private handlers: ClientEventHandlers = {};
  private conversationItems: ConversationItem[] = [];
  private connected = false;
  private disposed = false;
  private itemCounter = 0;
  // Per-instance prefix so item IDs are globally unique across client
  // instances. In "both" mode the speaker and participant channels each
  // construct their own LocalInferenceClient; without this, both counters
  // start at 0 and mint identical IDs (e.g. local_asst_2 on both), which
  // collides downstream — notably the karaoke highlight, which keys on
  // item.id alone and would light two conversation items at once. Mirrors
  // the instanceId pattern already used by GeminiClient/VolcengineSTClient.
  private readonly instanceId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Streaming ASR: in-progress partial result item
  private partialUserItem: ConversationItem | null = null;

  // Sentence segmentation: the runtime and per-bubble sentence count, read
  // once from ClientOptions in the constructor — the client never touches a
  // store (see the constructor). Absent or disabled means today's behaviour
  // exactly; see ensureStream().
  private segmentation: SegmentationRuntime | null = null;
  private sentencesPerChunk = 3;
  /** One stream per utterance, source side. Null between utterances. */
  private stream: SentenceStream | null = null;
  /**
   * Characters of the current utterance's raw ASR text already folded into a
   * seal. `SentenceStream.update()` expects "the whole current text since
   * the last seal" (see SentenceStream.ts's own doc comment and its
   * "never un-seals" test) — not the cumulative hypothesis a streaming ASR
   * actually reports on every partial (confirmed against
   * sherpa-onnx-streaming-asr.worker.js: `getResult()` only resets on
   * endpoint, never between partials). Re-slicing the raw text by this
   * cursor on every call is what turns that cumulative growth into the delta
   * the stream expects; feeding it the raw text unsliced would re-detect and
   * re-seal the same early sentences on every later partial. Reset to 0
   * whenever a fresh stream is created (ensureStream()).
   *
   * Advanced from the `onPending` callback, NOT by the sealed text's own
   * length: on the model path, `SentenceStream.applyResult()` seals the
   * *punctuated* output (`result.text.slice(0, cut)`) while only advancing
   * the raw tail to `dropped + rawCut` (SentenceStream.ts) — those lengths
   * differ by exactly the marks the model inserted. Advancing by the sealed
   * text's length would over-consume the raw text by that many characters
   * per seal, silently deleting real speech from the next chunk. `onPending`
   * always reports a suffix of whatever was last passed to `update()` (see
   * `seal()`, which calls `onPending(remainder)` right after `onSeal`), so
   * `passed.length - remainder.length` is exactly how many RAW characters
   * this update() call has consumed so far — see `feedStream()` and the
   * `onPending` wiring in `ensureStream()`.
   */
  private sealedChars = 0;
  /** `sealedChars` at the moment `lastPassedToStream` was handed to
   *  `stream.update()` — the base the `onPending` recompute in
   *  `ensureStream()` adds to. Set by `feedStream()`. */
  private sealedCharsBase = 0;
  /** The exact string most recently passed to `stream.update()` (already
   *  sliced by `sealedCharsBase`). Always a suffix relationship holds between
   *  this and whatever `onPending` reports afterward — see the `sealedChars`
   *  field doc. Set by `feedStream()`. */
  private lastPassedToStream = '';
  /**
   * The full raw text most recently handed to `handlePartialAsrResult`,
   * before slicing by `sealedChars` — unlike `lastPassedToStream`, never
   * itself sliced. Used to tell a genuinely different ASR result apart from
   * one that merely re-decoded (and truncated) the SAME utterance, wherever
   * a new result would otherwise slice to an empty relative tail — see
   * `isTruncationOfSameUtterance()`.
   */
  private lastRawPartialText = '';
  /** Set by handleAsrResult AFTER it feeds the final text to the stream but
   *  BEFORE calling end() — not before feedStream(), because update() alone
   *  can seal more than one chunk synchronously (evaluate() loops over full
   *  N-sentence groups, e.g. an offline final of >=2N sentences), and only
   *  the chunk end() emits for the true tail may carry the timing. Read by
   *  sealUserChunk when it pushes the job. Undefined at every other moment,
   *  which is what makes the earlier chunks carry none. */
  private pendingAsrTiming: AsrTiming | undefined;

  // AST mode: ASR produces translated text directly, skip translation engine
  private astMode = false;

  // TTS queue for serial processing
  private ttsQueue: PipelineJob[] = [];
  private ttsProcessing = false;

  /**
   * Cached from `config.keepReplayAudio` at session start. When false, each
   * call to `appendItemAudio()` is skipped — `item.formatted.audio` stays
   * empty, hiding the inline replay button. Real-time TTS playback (via the
   * audio service through `onConversationUpdated({ delta: { audio } })`) is
   * unaffected.
   */
  private keepReplayAudio: boolean = false;

  /**
   * `options` carries only what LocalInferenceClient needs, not the full
   * ClientOptions the descriptor sees — mirrors OpenAIWebRTCClient's own
   * narrow constructor shape rather than depending on the providers layer's
   * type. The client never touches a store: N and the runtime ride on
   * ClientOptions precisely so a running session cannot react to either
   * setting changing, and so a disabled/absent runtime behaves exactly as
   * today (see ensureStream()).
   */
  constructor(options: { segmentation?: SegmentationRuntime | null; sentencesPerChunk?: number } = {}) {
    this.segmentation = options.segmentation ?? null;
    this.sentencesPerChunk = options.sentencesPerChunk ?? 3;
  }

  /**
   * Helper to wrap an engine init call with per-engine progress event emission and timing.
   */
  private async trackInit<T>(
    engineName: 'asr' | 'translation' | 'tts',
    modelId: string,
    initFn: () => Promise<T>,
  ): Promise<T> {
    this.emitEvent(`local.init.${engineName}.start`, 'client', { model: modelId });
    const startTime = performance.now();
    try {
      const result = await initFn();
      const initDurationMs = Math.round(performance.now() - startTime);
      this.emitEvent(`local.init.${engineName}.ready`, 'client', { model: modelId, initDurationMs });
      return result;
    } catch (error) {
      this.emitEvent(`local.init.${engineName}.error`, 'client', {
        model: modelId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * If the active TTS engine is Supertonic and the configured sid isn't in the
   * actually-loaded voices, emit a warning. The worker has its own fallback
   * (substituting defaultSid at generate time), so this is purely diagnostic —
   * we don't mutate any state here. The UI layer reconciles the user setting
   * separately (see VoiceLibrarySection).
   */
  private reconcileSupertonicSidIfNeeded(
    config: { ttsModelId?: string; ttsSpeakerId?: number },
    ready: { voices?: Array<{ sid: number }>; sampleRate: number } | null | undefined,
  ): void {
    if (!ready?.voices || ready.voices.length === 0) return;
    if (typeof config.ttsSpeakerId !== 'number') return;
    const sids = new Set(ready.voices.map(v => v.sid));
    if (sids.has(config.ttsSpeakerId)) return;
    // The worker substitutes the model's defaultSid at generate time, so
    // synthesis still works. Just log — do NOT call onError, which MainPanel
    // treats as a hard session failure (would spuriously surface as a red
    // banner every reconnect for a user who just deleted an imported voice).
    this.diagnose(
      'voice_fallback',
      `Configured voice ${config.ttsSpeakerId} is not loaded; using the model default. Update the selection in settings.`,
    );
  }


  /**
   * Emit a diagnostic: the session continues, degraded. participantTelemetry
   * gives the code its channel and severity.
   */
  private diagnose(code: ClientDiagnosticCode, message: string, cause?: unknown): void {
    this.handlers.onDiagnostic?.({ code, message, cause });
  }

  async connect(config: SessionConfig): Promise<void> {
    if (!isLocalInferenceSessionConfig(config)) {
      throw new Error('LocalInferenceClient requires LocalInferenceSessionConfig');
    }

    this.config = config;
    this.disposed = false;
    this.conversationItems = [];
    this.itemCounter = 0;
    this.ttsEngine = null;
    this.keepReplayAudio = config.keepReplayAudio ?? false;
    // A reconnect without an intervening disconnect() must not inherit a
    // stream opened under the PREVIOUS config: ensureStream() returns an
    // existing stream before it ever re-checks astMode, so a stale non-AST
    // stream could otherwise survive into an AST session and bypass its
    // placeholder-only bubble.
    this.stream?.dispose();
    this.stream = null;
    this.sealedChars = 0;
    this.pendingAsrTiming = undefined;
    this.lastRawPartialText = '';

    try {
      // --- Create engines & set callbacks synchronously ---

      // ASR engine — detect streaming vs offline model
      const asrModel = getManifestEntry(config.asrModelId);
      console.info('[LocalInference] Initializing ASR engine:', config.asrModelId, '(type:', asrModel?.type, ')');

      if (asrModel?.type === 'asr-stream') {
        const engine = new StreamingAsrEngine();

        engine.onPartialResult = (text) => {
          if (this.disposed) return;
          this.handlePartialAsrResult(text);
        };

        engine.onResult = (result) => {
          if (this.disposed) return;
          const text = result.text.trim();
          if (!text) return;
          console.debug('[LocalInference] Streaming ASR result:', text, `(${result.durationMs}ms, ${result.recognitionTimeMs}ms recognition)`);
          this.handleAsrResult(text, { durationMs: result.durationMs, recognitionTimeMs: result.recognitionTimeMs });
        };

        engine.onSpeechStart = () => {
          if (this.disposed) return;
          this.emitEvent('local.asr.start', 'server', { modelId: this.config?.asrModelId });
        };

        engine.onError = (error) => {
          // No log line: emitted as local.asr.error and onError immediately below.
          this.emitEvent('local.asr.error', 'server', { error });
          this.handlers.onError?.(new Error(`ASR: ${error}`));
        };

        this.asrEngine = engine;
      } else {
        const engine = new AsrEngine();

        engine.onSpeechStart = () => {
          if (this.disposed) return;
          this.emitEvent('local.asr.start', 'server', { modelId: this.config?.asrModelId });
        };

        engine.onPartialResult = (text) => {
          if (this.disposed) return;
          this.handlePartialAsrResult(text);
        };

        engine.onResult = (result) => {
          if (this.disposed) return;
          const text = result.text.trim();
          if (!text) return;
          console.debug('[LocalInference] ASR result:', text, `(${result.durationMs}ms speech, ${result.recognitionTimeMs}ms recognition)`);
          this.handleAsrResult(text, { durationMs: result.durationMs, recognitionTimeMs: result.recognitionTimeMs });
        };

        engine.onError = (error) => {
          // No log line: emitted as local.asr.error and onError immediately below.
          this.emitEvent('local.asr.error', 'server', { error });
          this.handlers.onError?.(new Error(`ASR: ${error}`));
        };

        this.asrEngine = engine;
      }

      // Translation engine — skip when no model available (participant ASR-only)
      // or when ASR model handles AST directly (Granite Speech)
      const isAstMode = asrModel?.asrEngine === 'granite-speech'
        && config.translationModelId === config.asrModelId;
      this.astMode = isAstMode;

      if (isAstMode) {
        console.info('[LocalInference] AST mode: Granite Speech handles translation, skipping translation engine');
        this.translationEngine = null;
      } else if (config.translationModelId) {
        console.info('[LocalInference] Initializing Translation engine:', config.translationModelId, `(${config.sourceLanguage} → ${config.targetLanguage})`);
        this.translationEngine = new TranslationEngine();
      } else {
        console.info('[LocalInference] No translation model — ASR-only mode');
        this.translationEngine = null;
      }

      // Determine which engines will be initialized
      const engines = ['asr'];
      if (this.translationEngine) engines.push('translation');
      if (config.ttsModelId && !config.textOnly) engines.push('tts');
      this.emitEvent('local.init.start', 'client', { engines: [...engines] });

      // TTS engine (optional — skip when textOnly or no TTS model configured)
      if (config.ttsModelId && !config.textOnly) {
        console.info('[LocalInference] Initializing TTS engine:', config.ttsModelId);
        this.ttsEngine = new TtsEngine();
      } else {
        console.info('[LocalInference] No TTS:', config.textOnly ? 'text-only mode' : 'no TTS model configured');
      }

      // --- Fire all init() calls in parallel ---

      const asrPromise = this.trackInit('asr', config.asrModelId, () => {
        const vadConfig = {
          threshold: config.vadThreshold,
          // 0/absent lets the worker derive it from `threshold`; it is clamped
          // to never sit above it, which would disable endpoint detection.
          negativeThreshold: config.vadNegativeThreshold || undefined,
          minSilenceDuration: config.vadMinSilenceDuration,
          minSpeechDuration: config.vadMinSpeechDuration,
          maxSpeechDuration: config.vadMaxSpeechDuration,
        };
        if (asrModel?.type === 'asr-stream') {
          return (this.asrEngine as StreamingAsrEngine).init(config.asrModelId, {
            language: config.sourceLanguage,
            vadConfig,
            // The negation of ensureStream()'s condition, and it must stay that
            // way: whichever of the two layers seals, exactly one must. AST
            // mode is unreachable here today (both granite cards are type
            // 'asr'), but an AST stream with both endpoints off would never
            // seal at all.
            punctuationEndpoint: isAstMode || !this.segmentation?.enabled,
          });
        } else {
          const taskConfig = isAstMode
            ? { task: 'translate' as const, targetLanguage: config.targetLanguage }
            : undefined;
          return (this.asrEngine as AsrEngine).init(config.asrModelId, vadConfig, config.sourceLanguage, taskConfig);
        }
      });

      const translationPromise = this.translationEngine
        ? this.trackInit('translation', config.translationModelId!, () =>
            this.translationEngine!.init(config.sourceLanguage, config.targetLanguage, config.translationModelId),
          )
        : Promise.resolve(null);

      // TTS catches its own errors for graceful degradation
      const ttsPromise = this.ttsEngine
        ? this.trackInit('tts', config.ttsModelId!, async () => {
            const ready = await this.ttsEngine!.init(config.ttsModelId!);
            this.reconcileSupertonicSidIfNeeded(config, ready);
            return ready;
          }).catch((error) => {
            this.diagnose('tts_degraded', `TTS unavailable, continuing without it: ${describeCause(error)}`, error);
            this.handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
            this.ttsEngine?.dispose();
            this.ttsEngine = null;
            return null;
          })
        : Promise.resolve(null);

      const results = await Promise.allSettled([asrPromise, translationPromise, ttsPromise]);

      // Check ASR result
      if (results[0].status === 'rejected') {
        throw new Error(`ASR engine init failed: ${results[0].reason instanceof Error ? results[0].reason.message : String(results[0].reason)}`);
      }
      console.info('[LocalInference] ASR engine ready');

      // Check Translation result (skip if ASR-only or AST mode)
      if (this.translationEngine) {
        if (results[1].status === 'rejected') {
          throw new Error(`Translation engine init failed: ${results[1].reason instanceof Error ? results[1].reason.message : String(results[1].reason)}`);
        }
        console.info('[LocalInference] Translation engine ready');
      }

      // TTS result (already handled via catch above, just log success)
      if (this.ttsEngine) {
        console.info('[LocalInference] TTS engine ready (sampleRate:', this.ttsEngine.sampleRate, ', speakers:', this.ttsEngine.numSpeakers, ')');
      }

      this.connected = true;
      this.emitEvent('local.session.opened', 'client', {
        asrModel: config.asrModelId,
        translationPair: `${config.sourceLanguage} → ${config.targetLanguage}`,
        ttsModel: config.ttsModelId ?? null,
      });
      this.handlers.onOpen?.();
    } catch (error) {
      // Clean up on failure
      this.asrEngine?.dispose();
      this.asrEngine = null;
      this.translationEngine?.dispose();
      this.translationEngine = null;
      this.ttsEngine?.dispose();
      this.ttsEngine = null;

      // Surface a user-friendly message when GPU runs out of memory
      if (isGpuOutOfMemoryError(error)) {
        // No log line: rethrown as GpuOutOfMemoryError into the connect catch.
        throw new GpuOutOfMemoryError(i18n.t('errors.gpuOutOfMemory'));
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.disposed = true;
    this.connected = false;
    this.ttsQueue = [];
    this.ttsProcessing = false;
    this.partialUserItem = null;
    this.astMode = false;
    this.stream?.dispose();
    this.stream = null;
    this.sealedChars = 0;
    this.pendingAsrTiming = undefined;
    this.lastRawPartialText = '';

    this.asrEngine?.dispose();
    this.asrEngine = null;
    this.translationEngine?.dispose();
    this.translationEngine = null;
    this.ttsEngine?.dispose();
    this.ttsEngine = null;

    this.emitEvent('local.session.closed', 'client', { reason: 'user_disconnect' });
    this.handlers.onClose?.({});
  }

  isConnected(): boolean {
    return this.connected;
  }

  updateSession(config: Partial<SessionConfig>): void {
    if (this.config && isLocalInferenceSessionConfig(config as SessionConfig)) {
      this.config = { ...this.config, ...(config as Partial<LocalInferenceSessionConfig>) };
    }
  }

  reset(): void {
    this.conversationItems = [];
    this.itemCounter = 0;
    // Matches clearConversationItems(): without this, the dangling bubble is
    // no longer in conversationItems, yet the next onPending would still
    // write into it and the next seal would still complete it.
    this.partialUserItem = null;
    // Without this, a stream left open from the utterance in progress could
    // still deliver a seal (and its job) against a conversation that was
    // just cleared out from under it.
    this.stream?.dispose();
    this.stream = null;
    this.sealedChars = 0;
    this.lastRawPartialText = '';
  }

  appendInputAudio(audioData: Int16Array): void {
    if (!this.asrEngine || this.disposed) return;
    this.asrEngine.feedAudio(audioData, 24000);
  }

  appendInputText(text: string): void {
    if (this.disposed || !text.trim()) return;
    // Skip ASR, feed text directly to translation pipeline. handleAsrResult
    // also runs this through the sentence stream when segmentation is
    // active, so a long typed message seals into several bubbles/jobs
    // exactly like a long spoken utterance would — an accepted consequence
    // of routing text input through the same finalization path as ASR, not
    // a special case this method avoids.
    this.handleAsrResult(text.trim());
  }

  createResponse(_config?: ResponseConfig): void {
    // In Auto mode the pipeline is triggered by ASR/VAD results automatically.
    // In Push-to-Talk mode this is called on key release to flush any pending
    // ASR utterance that hasn't hit endpoint/silence detection yet.
    this.asrEngine?.flush();
  }

  cancelResponse(_trackId?: string, _offset?: number): void {
    // No-op
  }

  getConversationItems(): ConversationItem[] {
    return [...this.conversationItems];
  }

  clearConversationItems(): void {
    this.conversationItems = [];
    this.partialUserItem = null;
    // Same reasoning as reset(): a cleared conversation must not still
    // receive a seal (and its job) from the utterance that was in progress
    // before the clear.
    this.stream?.dispose();
    this.stream = null;
    this.sealedChars = 0;
    this.lastRawPartialText = '';
  }

  setEventHandlers(handlers: ClientEventHandlers): void {
    this.handlers = handlers;
  }

  getProvider(): ProviderType {
    return Provider.LOCAL_INFERENCE;
  }

  // ─── Event Emission ──────────────────────────────────────

  private emitEvent(type: string, source: 'client' | 'server', data: Record<string, any>): void {
    this.handlers.onRealtimeEvent?.({
      source,
      event: { type, data },
    });
  }

  /**
   * Append a TTS audio chunk onto the assistant item so the inline replay
   * button (ConversationRow → handlePlayAudio) has a complete Int16Array to
   * play back. Without this, chunks only stream through the audio player and
   * `item.formatted.audio` stays empty, leaving the replay button disabled.
   */
  private appendItemAudio(item: ConversationItem, chunk: Int16Array): void {
    if (!item.formatted) item.formatted = {};
    const prev = item.formatted.audio;
    if (prev instanceof Int16Array && prev.length > 0) {
      const combined = new Int16Array(prev.length + chunk.length);
      combined.set(prev);
      combined.set(chunk, prev.length);
      item.formatted.audio = combined;
    } else {
      item.formatted.audio = new Int16Array(chunk);
    }
  }

  // ─── Pipeline ─────────────────────────────────────────────

  /**
   * The stream for the utterance in progress, created on first text.
   *
   * Returns null — meaning "no segmentation, behave exactly as today" — in
   * AST mode (there the ASR output is already the translation, and the user
   * bubble only ever shows a placeholder), with no runtime, or with a
   * disabled one. The disabled check matters here and not just inside
   * SentenceStream: SentenceStream's own contract for "no runtime or
   * disabled" is "no sealing at all" (see its `active()`), which means its
   * `end()` never calls `onSeal` for the tail — if this method still built a
   * live-but-inert stream for a disabled runtime, the whole utterance would
   * be silently dropped (no item, no job) instead of completing as one item
   * and one job the way it does today. Checking segmentation before ever
   * constructing a stream is what keeps that guarantee.
   *
   * An already-open stream is always reused regardless of a later change to
   * `segmentation`/`astMode` (checked first, before the guards) — mirroring
   * "N is read once per stream" and avoiding orphaning an in-flight stream
   * if the setting flips mid-utterance.
   */
  private ensureStream(): SentenceStream | null {
    // Reuse the existing stream if already constructed. This is safe only because
    // SentenceSegmentationSection.tsx holds `disabled={isSessionActive}` on the
    // toggle, preventing the setting from changing mid-session. If that guard is
    // ever removed, a mid-utterance toggle-off would reuse this stream even though
    // runtime.enabled is now false: end() would not seal, the tail would be lost,
    // and the stranded user bubble would be overwritten by the next utterance.
    if (this.stream) return this.stream;
    if (this.astMode || !this.segmentation || !this.segmentation.enabled) return null;
    this.sealedChars = 0;
    this.stream = new SentenceStream({
      // The leg's own config, not a reversal of the speaker's. The participant
      // direction already resolves target->source into its own
      // sourceLanguage (see localParticipantConfig.ts), so reading
      // config.sourceLanguage here is correct for both legs and there is
      // nothing to flip.
      lang: this.config?.sourceLanguage ?? 'auto',
      runtime: this.segmentation,
      sentencesPerChunk: this.sentencesPerChunk,
      onSeal: (chunk) => this.sealUserChunk(chunk.text),
      onPending: (text) => {
        // Recompute the RAW cursor from how much of what feedStream() last
        // handed the stream remains unconsumed — see the sealedChars field
        // doc. Cannot advance by the sealed text's own length in sealUserChunk
        // instead: the model path's seal can be a different length than the
        // raw input it consumed (SentenceStream.applyResult inserts
        // punctuation), so that would drift the cursor and silently delete
        // raw characters from the next chunk.
        this.sealedChars = this.sealedCharsBase + this.lastPassedToStream.length - text.length;
        this.showPartialUserText(text);
      },
    });
    return this.stream;
  }

  /**
   * Slice the raw ASR text by `sealedChars` and feed the relative tail to the
   * stream, recording what was passed so the `onPending` callback (wired in
   * ensureStream()) can recompute `sealedChars` from the remainder it
   * reports afterward.
   */
  private feedStream(stream: SentenceStream, text: string): void {
    const relative = text.slice(this.sealedChars);
    this.sealedCharsBase = this.sealedChars;
    this.lastPassedToStream = relative;
    stream.update(relative);
  }

  /**
   * True when `text` looks like a truncated re-decode of the SAME utterance
   * that `previousRaw` already captured more of — i.e., `text` is a prefix
   * of `previousRaw` — rather than genuinely different content.
   *
   * Used wherever a new ASR result would otherwise slice to an empty
   * relative tail (see handlePartialAsrResult/handleAsrResult): a seal
   * requires >=8 skeleton characters of right context, so the partial always
   * extended well past the cursor at seal time, and a canonical re-decode
   * that drops that retracted tail (voxtral-3b-webgpu.worker.ts documents
   * this fallback) can land at or below the cursor while still beginning
   * with the same words.
   *
   * Compares TRIMMED forms, not raw ones: `voxtral-3b-webgpu.worker.ts` and
   * `cohere-transcribe-webgpu.worker.ts` both build the accumulated partial
   * from `TextStreamer`'s untrimmed token deltas (`accumulatedText += token`)
   * but `.trim()` only the final. An anchored `startsWith` on the raw strings
   * is exactly wrong at that edge — a leading-whitespace token would make a
   * genuine truncation read as divergence, re-sealing and re-queuing a job
   * for text already sealed. Trimming only inside this comparison is safe:
   * the return value is a plain boolean, so no offset math anywhere
   * downstream ever sees a trimmed string — `sealedChars` and every slice
   * still operate on the untrimmed raw text exactly as before.
   *
   * SentenceStream's own notion of "same utterance" is skeleton-based
   * (letters/digits only, case-folded — see sentenceEnd.ts's `skeleton()`,
   * used by SentenceStream.applyResult's stale-answer check). `skeleton()`
   * is a named export of sentenceEnd.ts, not internal to SentenceStream, so
   * it IS reachable from here — but deliberately not used: this client is
   * meant to interact with the segmentation stage only through
   * SentenceStream/SegmentationRuntime, not its internal comparison rules,
   * and a trimmed-prefix check answers the narrow question asked here — is
   * this final a truncation of the same utterance — just as well.
   */
  private isTruncationOfSameUtterance(text: string, previousRaw: string): boolean {
    const trimmedText = text.trim();
    return trimmedText.length > 0 && previousRaw.trim().startsWith(trimmedText);
  }

  /** Finish the in-progress user bubble at the seal and queue its translation. */
  private sealUserChunk(text: string): void {
    if (this.partialUserItem) {
      this.partialUserItem.formatted!.transcript = text;
      this.partialUserItem.status = 'completed';
      this.handlers.onConversationUpdated?.({ item: this.partialUserItem });
      this.partialUserItem = null;
    } else {
      const item: ConversationItem = {
        id: `${this.instanceId}_user_${++this.itemCounter}`,
        role: 'user',
        type: 'message',
        status: 'completed',
        createdAt: Date.now(),
        formatted: { transcript: text },
      };
      this.conversationItems.push(item);
      this.handlers.onConversationUpdated?.({ item });
    }
    // The ASR timing describes the whole utterance, so it rides the final job
    // only — attaching it to each chunk would report one utterance N times.
    // pendingAsrTiming is set by handleAsrResult only after feedStream()
    // returns and only right before end(), so only the chunk emitted from
    // end() sees it — see its field doc for why the ordering matters.
    this.ttsQueue.push({ text, ...(this.pendingAsrTiming && { asrTiming: this.pendingAsrTiming }) });
    this.processQueue();
  }

  /**
   * Handle partial (interim) ASR result from streaming recognizer.
   * Creates or updates an in_progress user item with interim text.
   */
  private showPartialUserText(text: string): void {
    if (this.partialUserItem) {
      // Update existing partial item
      this.partialUserItem.formatted!.transcript = text;
      this.handlers.onConversationUpdated?.({ item: this.partialUserItem });
    } else {
      // Create new in_progress item
      this.partialUserItem = {
        id: `${this.instanceId}_user_${++this.itemCounter}`,
        role: 'user',
        type: 'message',
        status: 'in_progress',
        createdAt: Date.now(),
        formatted: {
          transcript: text,
        },
      };
      this.conversationItems.push(this.partialUserItem);
      this.handlers.onConversationUpdated?.({ item: this.partialUserItem });
    }
  }

  /**
   * Route a partial ASR result: through the sentence stream when
   * segmentation is active, or straight to the bubble when it is not (no
   * runtime, disabled, or AST mode — see ensureStream()).
   *
   * `text` is the ASR's cumulative hypothesis for the whole utterance so far,
   * not a delta (confirmed against sherpa-onnx-streaming-asr.worker.js:
   * `getResult()` is only reset on endpoint, never between partials).
   * feedStream() slices off `sealedChars` before handing it to the stream —
   * feeding the raw cumulative text unsliced would re-detect and re-seal
   * already-sealed sentences on every later partial.
   */
  private handlePartialAsrResult(text: string): void {
    this.emitEvent('local.asr.partial', 'server', { text });
    const previousRaw = this.lastRawPartialText;
    this.lastRawPartialText = text;
    const stream = this.ensureStream();
    if (!stream) {
      this.showPartialUserText(text);
      return;
    }
    if (text.length > 0 && text.slice(this.sealedChars).length === 0) {
      if (this.isTruncationOfSameUtterance(text, previousRaw)) {
        // The engine retracted its hypothesis back to (or below) what's
        // already sealed — the same question handleAsrResult's final guard
        // answers, see isTruncationOfSameUtterance(). Nothing new to show
        // yet: leave the bubble and the cursor alone. Self-healing, since
        // partials keep growing — the next one either catches back up to
        // this shape or genuinely supersedes it.
        return;
      }
      // Genuinely different text: the engine changed its mind entirely for
      // this utterance. Start segmentation over rather than feed a cursor
      // that no longer describes anything this text contains.
      this.sealedChars = 0;
    }
    this.feedStream(stream, text);
  }

  private handleAsrResult(text: string, timing?: AsrTiming): void {
    // ensureStream() — not a bare read of this.stream — is what lets an
    // offline final (which never fires a partial) still seal: it creates the
    // stream fresh here, with sealedChars at 0, so update() sees the whole
    // final text. For a streaming utterance this reuses the stream partials
    // already opened; its earlier seals already produced their items and
    // jobs, and what remains here is just the tail.
    const previousRaw = this.lastRawPartialText;
    const stream = this.ensureStream();
    if (stream) {
      // Some engines produce the final as a canonical re-decode rather than
      // reusing the accumulated partial (voxtral-3b-webgpu.worker.ts
      // documents this fallback), so the final's prefix is not guaranteed to
      // still match what earlier partials sealed. Slicing by a cursor that no
      // longer applies would hand the stream an empty string — blanking the
      // open bubble via onPending('') and then end() never sealing an empty
      // tail, stranding it in_progress with nothing translated.
      let skipJob = false;
      if (text.length > 0 && text.slice(this.sealedChars).length === 0) {
        if (this.isTruncationOfSameUtterance(text, previousRaw)) {
          // A truncated re-decode of the SAME utterance, not genuinely
          // different content: the confirmed text is already fully captured
          // by the earlier seal(s). Sealing again here would translate — and
          // with TTS on, speak — the same sentence a second time. Close out
          // the open bubble without a job instead, and leave the cursor
          // alone (the teardown below still resets it for the NEXT
          // utterance, same as every other path through this method).
          skipJob = true;
        } else {
          // Genuinely different text: restart the cursor so the whole final
          // still seals as (at least) one chunk instead of feeding ''.
          this.sealedChars = 0;
        }
      }
      if (skipJob) {
        if (this.partialUserItem) {
          this.partialUserItem.status = 'completed';
          this.handlers.onConversationUpdated?.({ item: this.partialUserItem });
          this.partialUserItem = null;
        }
      } else {
        // update() first, WITHOUT the timing attached yet: it can seal more
        // than one chunk synchronously on its own (evaluate() loops over full
        // N-sentence groups — e.g. an offline final of >=2N sentences), and
        // those chunks must not carry it. pendingAsrTiming is set only after
        // update() returns, so only the chunk end() emits for the true tail —
        // the remainder update() left pending — sees it.
        this.feedStream(stream, text);
        this.pendingAsrTiming = timing;
        // The remainder update() left pending becomes the last chunk — the
        // last item and the last job, carrying the utterance's timing.
        stream.end();
      }
      stream.dispose();
      this.stream = null;
      this.sealedChars = 0;
      this.pendingAsrTiming = undefined;
      this.emitEvent('local.asr.end', 'server', {
        text,
        modelId: this.config?.asrModelId,
        ...(timing && { durationMs: timing.durationMs, recognitionTimeMs: timing.recognitionTimeMs }),
      });
      return;
    }

    // In AST mode, text is already translated — show placeholder for user item
    const userTranscript = this.astMode
      ? i18n.t('mainPanel.speechDetected')
      : text;

    if (this.partialUserItem) {
      // Finalize the partial item from streaming ASR
      this.partialUserItem.formatted!.transcript = userTranscript;
      this.partialUserItem.status = 'completed';
      this.handlers.onConversationUpdated?.({ item: this.partialUserItem });
      this.partialUserItem = null;
    } else {
      // Create new completed user item (offline ASR path)
      const userItem: ConversationItem = {
        id: `${this.instanceId}_user_${++this.itemCounter}`,
        role: 'user',
        type: 'message',
        status: 'completed',
        createdAt: Date.now(),
        formatted: {
          transcript: userTranscript,
        },
      };
      this.conversationItems.push(userItem);
      this.handlers.onConversationUpdated?.({ item: userItem });
    }

    this.emitEvent('local.asr.end', 'server', {
      text,
      modelId: this.config?.asrModelId,
      ...(timing && { durationMs: timing.durationMs, recognitionTimeMs: timing.recognitionTimeMs }),
    });

    // Enqueue translation + TTS
    this.ttsQueue.push({ text, asrTiming: timing });
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.ttsProcessing) return;
    this.ttsProcessing = true;

    while (this.ttsQueue.length > 0) {
      if (this.disposed) break;

      const job = this.ttsQueue.shift()!;
      await this.processPipelineJob(job);
    }

    this.ttsProcessing = false;
  }

  private async processPipelineJob(job: PipelineJob): Promise<void> {
    const itemId = `${this.instanceId}_asst_${++this.itemCounter}`;

    try {
      if (this.disposed) return;

      let displayText: string;

      if (this.translationEngine) {
        // Full pipeline: translate then display
        const resolvedPrompt = this.config?.instructions || '';
        const wrapTranscript = this.config?.wrapTranscript ?? true;
        this.emitEvent('local.translation.start', 'client', {
          sourceText: job.text,
          modelId: this.config?.translationModelId,
          systemPrompt: resolvedPrompt,
          wrapTranscript,
        });
        const translationResult = await this.translationEngine.translate(
          job.text,
          resolvedPrompt,
          wrapTranscript,
        );
        if (this.disposed) return;

        const translatedText = translationResult.translatedText;
        console.debug(
          '[LocalInference] Translation:', job.text, '→', translatedText,
          `(${translationResult.inferenceTimeMs}ms)`,
          '\n  systemPrompt:', translationResult.systemPrompt,
          '\n  wrapTranscript:', wrapTranscript,
        );

        if (!translatedText) {
          console.debug('[LocalInference] Translation empty — skipping:', job.text);
          return;
        }

        this.emitEvent('local.translation.end', 'server', {
          sourceText: job.text,
          translatedText,
          inferenceTimeMs: translationResult.inferenceTimeMs,
          systemPrompt: translationResult.systemPrompt,
          wrapTranscript,
          modelId: this.config?.translationModelId,
        });
        displayText = translatedText;
      } else if (this.astMode) {
        // AST mode: ASR already produced translated text
        displayText = job.text;
        console.debug('[LocalInference] AST mode — text already translated:', displayText);
        if (!displayText) return;
      } else {
        // ASR-only mode: use source text directly as the assistant item
        console.debug('[LocalInference] ASR-only mode — displaying source text:', job.text);
        displayText = job.text;
      }

      // Create assistant item
      const assistantItem: ConversationItem = {
        id: itemId,
        role: 'assistant',
        type: 'message',
        status: 'in_progress',
        createdAt: Date.now(),
        formatted: { transcript: displayText },
      };
      this.conversationItems.push(assistantItem);
      this.handlers.onConversationUpdated?.({ item: assistantItem });

      // TTS (optional) — split into sentences for reduced time-to-first-audio
      if (this.ttsEngine && this.config && !this.disposed) {
        const ttsEntry = getManifestEntry(this.config.ttsModelId || '');
        const isEdgeTts = ttsEntry?.engine === 'edge-tts';

        const sentences = splitSentences(displayText, this.config.targetLanguage);
        const ttsStartTime = performance.now();
        this.emitEvent('local.tts.start', 'client', {
          text: displayText,
          sentenceCount: sentences.length,
          modelId: this.config?.ttsModelId,
          // Include voice identity (edge-tts voice name, or speaker ID for
          // local multi-speaker models) and speed so the LogsPanel reflects
          // exactly which configuration produced the audio.
          voice: isEdgeTts ? this.config.edgeTtsVoice : `speaker:${this.config.ttsSpeakerId}`,
          speed: this.config.ttsSpeed,
        });
        console.debug(`[Karaoke] TTS start: fullText="${displayText}" (${displayText.length} chars), ${sentences.length} sentences:`, sentences.map((s, i) => `[${i}] "${s}" (${s.length} chars)`));

        let searchFrom = 0;
        let cumulativeAudioDuration = 0;
        assistantItem.formatted!.audioSegments = [];

        for (let i = 0; i < sentences.length; i++) {
          if (this.disposed) return;

          try {
            this.emitEvent('local.tts.sentence.start', 'client', {
              sentenceIndex: i,
              sentenceCount: sentences.length,
              text: sentences[i],
            });

            if (isEdgeTts) {
              // Streaming path — Edge TTS sends audio-chunk messages.
              //
              // The non-streaming path updates audioTextEnd/audioSegments *before*
              // emitting the audio delta, so the renderer always has fresh karaoke
              // metadata when the audio plays. For streaming we pre-compute
              // audioTextEnd (we know which sentence we're about to speak) so
              // chunks emitted mid-stream already reference up-to-date metadata.
              // audioSegments can only be pushed after we know the total audio
              // duration, so we push + emit a metadata update once the stream ends.
              const pos = displayText.indexOf(sentences[i], searchFrom);
              const audioTextEnd = pos >= 0 ? pos + sentences[i].length : searchFrom + sentences[i].length;
              searchFrom = audioTextEnd;
              assistantItem.formatted!.audioTextEnd = audioTextEnd;

              let chunkSampleCount = 0;
              const sentenceStart = performance.now();
              await this.ttsEngine.generateStream(
                sentences[i],
                0,  // sid unused for edge-tts
                this.config.ttsSpeed,
                this.config.targetLanguage,
                (chunkSamples, chunkSampleRate) => {
                  if (this.disposed) return;
                  const resampled = resampleFloat32(chunkSamples, chunkSampleRate, 24000);
                  const int16Audio = float32ToInt16(resampled);
                  chunkSampleCount += int16Audio.length;
                  // Gated on keepReplayAudio — when off, the per-item replay
                  // buffer is skipped. Real-time playback below (via the audio
                  // delta) is unaffected. Karaoke math (sentenceAudioDuration)
                  // is computed from chunkSampleCount, not from the stored
                  // buffer, so gating does not affect it.
                  if (this.keepReplayAudio) {
                    this.appendItemAudio(assistantItem, int16Audio);
                  }
                  this.handlers.onConversationUpdated?.({
                    item: assistantItem,
                    delta: { audio: int16Audio },
                  });
                },
                this.config.edgeTtsVoice,
              );
              if (this.disposed) return;

              const sentenceAudioDuration = chunkSampleCount / 24000;
              cumulativeAudioDuration += sentenceAudioDuration;
              assistantItem.formatted!.audioSegments!.push({
                textEnd: audioTextEnd,
                audioEnd: cumulativeAudioDuration,
              });

              // Publish the finalized segment metadata so the renderer picks up
              // timing info without waiting for the full response to complete.
              this.handlers.onConversationUpdated?.({ item: assistantItem });

              const generateMs = Math.round(performance.now() - sentenceStart);
              this.emitEvent('local.tts.sentence.end', 'server', {
                sentenceIndex: i,
                sentenceCount: sentences.length,
                text: sentences[i],
                generateMs,
                audioDurationMs: Math.round(sentenceAudioDuration * 1000),
              });

              console.debug(`[Karaoke] TTS sentence ${i + 1}/${sentences.length}: "${sentences[i]}" → ${sentenceAudioDuration.toFixed(3)}s audio (streaming)`);
            } else {
              const sentenceStart = performance.now();
              const ttsResult = await this.ttsEngine.generate(
                sentences[i],
                this.config.ttsSpeakerId,
                this.config.ttsSpeed,
                this.config.targetLanguage,
              );
              if (this.disposed) return;

              // Track how far into the text TTS audio has been generated
              const pos = displayText.indexOf(sentences[i], searchFrom);
              const audioTextEnd = pos >= 0 ? pos + sentences[i].length : searchFrom + sentences[i].length;
              searchFrom = audioTextEnd;
              assistantItem.formatted!.audioTextEnd = audioTextEnd;

              // Resample to 24kHz and convert to Int16
              const resampled = resampleFloat32(ttsResult.samples, ttsResult.sampleRate, 24000);
              const int16Audio = float32ToInt16(resampled);

              // Track per-sentence audio-to-text mapping for accurate karaoke
              const sentenceAudioDuration = int16Audio.length / 24000;
              cumulativeAudioDuration += sentenceAudioDuration;
              assistantItem.formatted!.audioSegments!.push({
                textEnd: audioTextEnd,
                audioEnd: cumulativeAudioDuration,
              });

              const generateMs = Math.round(performance.now() - sentenceStart);
              this.emitEvent('local.tts.sentence.end', 'server', {
                sentenceIndex: i,
                sentenceCount: sentences.length,
                text: sentences[i],
                generateMs,
                audioDurationMs: Math.round(sentenceAudioDuration * 1000),
              });

              console.debug(`[Karaoke] TTS sentence ${i + 1}/${sentences.length}: "${sentences[i]}" (${sentences[i].length} chars) → ${sentenceAudioDuration.toFixed(3)}s audio | textEnd=${audioTextEnd}/${displayText.length}, cumAudio=${cumulativeAudioDuration.toFixed(3)}s`);

              // Emit audio delta immediately — player receives chunk right away.
              // The replay buffer (appendItemAudio) is gated on keepReplayAudio,
              // but the delta below dispatches to real-time playback regardless.
              // Karaoke math above uses int16Audio.length directly, not the
              // stored buffer, so it is unaffected.
              if (this.keepReplayAudio) {
                this.appendItemAudio(assistantItem, int16Audio);
              }
              this.handlers.onConversationUpdated?.({
                item: assistantItem,
                delta: { audio: int16Audio },
              });
            }
          } catch (ttsError) {
            this.diagnose('tts_degraded', `a sentence could not be spoken: ${describeCause(ttsError)}`, ttsError);
            this.emitEvent('local.tts.error', 'server', {
              error: ttsError instanceof Error ? ttsError.message : String(ttsError),
              sentenceIndex: i,
            });
          }
        }

        // Ensure trailing whitespace is covered
        assistantItem.formatted!.audioTextEnd = displayText.length;
        console.debug(`[Karaoke] TTS complete: ${assistantItem.formatted!.audioSegments!.length} segments, totalAudio=${cumulativeAudioDuration.toFixed(3)}s, totalChars=${displayText.length}`);

        const ttsDurationMs = performance.now() - ttsStartTime;
        this.emitEvent('local.tts.end', 'server', { sentenceCount: sentences.length, durationMs: Math.round(ttsDurationMs) });
      }

      // Mark completed
      assistantItem.status = 'completed';
      this.handlers.onConversationUpdated?.({ item: assistantItem });

    } catch (error) {
      // Session ending — expected, not an error
      if (this.disposed) return;

      // No log line: emitted as local.pipeline.error immediately below.
      const userMessage = humanizeTranslationError(error);
      this.emitEvent('local.pipeline.error', 'server', {
        error: error instanceof Error ? error.message : String(error),
        userMessage,
      });

      // Create error item with message already set
      const errorItem: ConversationItem = {
        id: itemId,
        role: 'assistant',
        type: 'error',
        status: 'completed',
        createdAt: Date.now(),
        formatted: { transcript: `Translation error: ${userMessage}` },
      };
      this.conversationItems.push(errorItem);
      this.handlers.onConversationUpdated?.({ item: errorItem });
    }
  }
}

/**
 * Maps a translation-worker error to a user-facing string.
 *
 * The Bing worker prefixes its error messages with a tag like `[bing:token]`
 * or `[bing:network]` (see src/lib/local-inference/workers/bing-translation.worker.ts).
 * This helper peels the tag off and picks a friendly sentence. Errors without
 * the tag fall through to the original message.
 */
const BING_ERROR_MESSAGES: Record<string, string> = {
  token: 'Bing Translator could not connect. Check your network and try again.',
  unsupported: 'Bing Translator does not support this language pair.',
  network: 'Bing Translator is temporarily unavailable.',
};

function humanizeTranslationError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (!raw) return 'Translation failed.';

  const match = raw.match(/^\[bing:(token|unsupported|network|unknown)\]\s*(.*)$/);
  if (match) {
    const tag = match[1];
    const detail = match[2];
    const known = BING_ERROR_MESSAGES[tag];
    if (known) return known;
    // For 'unknown' or unexpected tags, keep the original detail text so
    // diagnostic information isn't lost — still prefixed so it's obviously
    // a Bing failure, not a pipeline error.
    return detail ? `Bing Translator failed: ${detail}` : 'Bing Translator failed.';
  }

  return raw;
}
