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

  // Streaming ASR: in-progress partial result item
  private partialUserItem: ConversationItem | null = null;

  // TTS queue for serial processing
  private ttsQueue: PipelineJob[] = [];
  private ttsProcessing = false;

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

  async connect(config: SessionConfig): Promise<void> {
    if (!isLocalInferenceSessionConfig(config)) {
      throw new Error('LocalInferenceClient requires LocalInferenceSessionConfig');
    }

    this.config = config;
    this.disposed = false;
    this.conversationItems = [];
    this.itemCounter = 0;
    this.ttsEngine = null;

    // Determine which engines will be initialized
    const engines = ['asr', 'translation'];
    if (config.ttsModelId && !config.textOnly) engines.push('tts');
    this.emitEvent('local.init.start', 'client', { engines: [...engines] });

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
          console.error('[LocalInference] Streaming ASR error:', error);
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

        engine.onResult = (result) => {
          if (this.disposed) return;
          const text = result.text.trim();
          if (!text) return;
          console.debug('[LocalInference] ASR result:', text, `(${result.durationMs}ms speech, ${result.recognitionTimeMs}ms recognition)`);
          this.handleAsrResult(text, { durationMs: result.durationMs, recognitionTimeMs: result.recognitionTimeMs });
        };

        engine.onError = (error) => {
          console.error('[LocalInference] ASR error:', error);
          this.emitEvent('local.asr.error', 'server', { error });
          this.handlers.onError?.(new Error(`ASR: ${error}`));
        };

        this.asrEngine = engine;
      }

      // Translation engine
      console.info('[LocalInference] Initializing Translation engine:', config.sourceLanguage, '→', config.targetLanguage);
      this.translationEngine = new TranslationEngine();

      // TTS engine (optional — skip when textOnly or no TTS model configured)
      if (config.ttsModelId && !config.textOnly) {
        console.info('[LocalInference] Initializing TTS engine:', config.ttsModelId);
        this.ttsEngine = new TtsEngine();
      } else {
        console.info('[LocalInference] No TTS:', config.textOnly ? 'text-only mode' : 'no TTS model configured');
      }

      // --- Fire all init() calls in parallel ---

      const asrPromise = this.trackInit('asr', config.asrModelId, () => {
        if (asrModel?.type === 'asr-stream') {
          return (this.asrEngine as StreamingAsrEngine).init(config.asrModelId, { language: config.sourceLanguage });
        } else {
          return (this.asrEngine as AsrEngine).init(config.asrModelId, {
            threshold: config.vadThreshold,
            minSilenceDuration: config.vadMinSilenceDuration,
            minSpeechDuration: config.vadMinSpeechDuration,
          }, config.sourceLanguage);
        }
      });

      const translationPromise = this.trackInit('translation', config.translationModelId, () =>
        this.translationEngine!.init(config.sourceLanguage, config.targetLanguage, config.translationModelId),
      );

      // TTS catches its own errors for graceful degradation
      const ttsPromise = this.ttsEngine
        ? this.trackInit('tts', config.ttsModelId!, () => this.ttsEngine!.init(config.ttsModelId!)).catch((error) => {
            console.warn('[LocalInference] TTS init failed, continuing without TTS:', error);
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

      // Check Translation result
      if (results[1].status === 'rejected') {
        throw new Error(`Translation engine init failed: ${results[1].reason instanceof Error ? results[1].reason.message : String(results[1].reason)}`);
      }
      console.info('[LocalInference] Translation engine ready');

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
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.disposed = true;
    this.connected = false;
    this.ttsQueue = [];
    this.ttsProcessing = false;
    this.partialUserItem = null;

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
  }

  appendInputAudio(audioData: Int16Array): void {
    if (!this.asrEngine || this.disposed) return;
    this.asrEngine.feedAudio(audioData, 24000);
  }

  appendInputText(text: string): void {
    if (this.disposed || !text.trim()) return;
    // Skip ASR, feed text directly to translation pipeline
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

  // ─── Pipeline ─────────────────────────────────────────────

  /**
   * Handle partial (interim) ASR result from streaming recognizer.
   * Creates or updates an in_progress user item with interim text.
   */
  private handlePartialAsrResult(text: string): void {
    this.emitEvent('local.asr.partial', 'server', { text });

    if (this.partialUserItem) {
      // Update existing partial item
      this.partialUserItem.formatted!.transcript = text;
      this.handlers.onConversationUpdated?.({ item: this.partialUserItem });
    } else {
      // Create new in_progress item
      this.partialUserItem = {
        id: `local_user_${++this.itemCounter}`,
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

  private handleAsrResult(text: string, timing?: AsrTiming): void {
    if (this.partialUserItem) {
      // Finalize the partial item from streaming ASR
      this.partialUserItem.formatted!.transcript = text;
      this.partialUserItem.status = 'completed';
      this.handlers.onConversationUpdated?.({ item: this.partialUserItem });
      this.partialUserItem = null;
    } else {
      // Create new completed user item (offline ASR path)
      const userItem: ConversationItem = {
        id: `local_user_${++this.itemCounter}`,
        role: 'user',
        type: 'message',
        status: 'completed',
        createdAt: Date.now(),
        formatted: {
          transcript: text,
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
    const itemId = `local_asst_${++this.itemCounter}`;

    try {
      // Translate first — don't push item until we have content
      if (!this.translationEngine || this.disposed) return;
      this.emitEvent('local.translation.start', 'client', { sourceText: job.text, modelId: this.config?.translationModelId });
      const translationResult = await this.translationEngine.translate(job.text);
      if (this.disposed) return;

      const translatedText = translationResult.translatedText;
      console.debug('[LocalInference] Translation:', job.text, '→', translatedText, `(${translationResult.inferenceTimeMs}ms)`);

      // Skip empty translations (e.g. thinking-mode leakage stripped to nothing)
      if (!translatedText) {
        console.debug('[LocalInference] Translation empty — skipping:', job.text);
        return;
      }
      this.emitEvent('local.translation.end', 'server', {
        sourceText: job.text,
        translatedText,
        inferenceTimeMs: translationResult.inferenceTimeMs,
        systemPrompt: translationResult.systemPrompt,
        modelId: this.config?.translationModelId,
      });

      // Create assistant item with translation already set
      const assistantItem: ConversationItem = {
        id: itemId,
        role: 'assistant',
        type: 'message',
        status: 'in_progress',
        createdAt: Date.now(),
        formatted: { transcript: translatedText },
      };
      this.conversationItems.push(assistantItem);
      this.handlers.onConversationUpdated?.({ item: assistantItem });

      // TTS (optional) — split into sentences for reduced time-to-first-audio
      if (this.ttsEngine && this.config && !this.disposed) {
        const sentences = splitSentences(translatedText, this.config.targetLanguage);
        const ttsStartTime = performance.now();
        this.emitEvent('local.tts.start', 'client', { text: translatedText, sentenceCount: sentences.length, modelId: this.config?.ttsModelId });
        console.debug(`[Karaoke] TTS start: fullText="${translatedText}" (${translatedText.length} chars), ${sentences.length} sentences:`, sentences.map((s, i) => `[${i}] "${s}" (${s.length} chars)`));

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

            const sentenceStart = performance.now();
            const ttsResult = await this.ttsEngine.generate(
              sentences[i],
              this.config.ttsSpeakerId,
              this.config.ttsSpeed,
              this.config.targetLanguage,
            );
            if (this.disposed) return;

            // Track how far into the text TTS audio has been generated
            const pos = translatedText.indexOf(sentences[i], searchFrom);
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

            console.debug(`[Karaoke] TTS sentence ${i + 1}/${sentences.length}: "${sentences[i]}" (${sentences[i].length} chars) → ${sentenceAudioDuration.toFixed(3)}s audio | textEnd=${audioTextEnd}/${translatedText.length}, cumAudio=${cumulativeAudioDuration.toFixed(3)}s`);

            // Emit audio delta immediately — player receives chunk right away
            this.handlers.onConversationUpdated?.({
              item: assistantItem,
              delta: { audio: int16Audio },
            });
          } catch (ttsError) {
            console.warn(`[LocalInference] TTS failed for sentence ${i + 1}/${sentences.length}, skipping:`, ttsError);
            this.emitEvent('local.tts.error', 'server', {
              error: ttsError instanceof Error ? ttsError.message : String(ttsError),
              sentenceIndex: i,
            });
          }
        }

        // Ensure trailing whitespace is covered
        assistantItem.formatted!.audioTextEnd = translatedText.length;
        console.debug(`[Karaoke] TTS complete: ${assistantItem.formatted!.audioSegments!.length} segments, totalAudio=${cumulativeAudioDuration.toFixed(3)}s, totalChars=${translatedText.length}`);

        const ttsDurationMs = performance.now() - ttsStartTime;
        this.emitEvent('local.tts.end', 'server', { sentenceCount: sentences.length, durationMs: Math.round(ttsDurationMs) });
      }

      // Mark completed
      assistantItem.status = 'completed';
      this.handlers.onConversationUpdated?.({ item: assistantItem });

    } catch (error) {
      // Session ending — expected, not an error
      if (this.disposed) return;

      console.error('[LocalInference] Pipeline error:', error);
      this.emitEvent('local.pipeline.error', 'server', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Create error item with message already set
      const errorItem: ConversationItem = {
        id: itemId,
        role: 'assistant',
        type: 'error',
        status: 'completed',
        createdAt: Date.now(),
        formatted: { transcript: `Translation error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      };
      this.conversationItems.push(errorItem);
      this.handlers.onConversationUpdated?.({ item: errorItem });
    }
  }
}
