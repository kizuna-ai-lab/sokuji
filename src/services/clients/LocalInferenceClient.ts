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

interface PipelineJob {
  text: string;
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

  async connect(config: SessionConfig): Promise<void> {
    if (!isLocalInferenceSessionConfig(config)) {
      throw new Error('LocalInferenceClient requires LocalInferenceSessionConfig');
    }

    this.config = config;
    this.disposed = false;
    this.conversationItems = [];
    this.itemCounter = 0;

    try {
      // Initialize ASR engine — detect streaming vs offline model
      const asrModel = getManifestEntry(config.asrModelId);
      console.info('[LocalInference] Initializing ASR engine:', config.asrModelId, '(type:', asrModel?.type, ')');

      if (asrModel?.type === 'asr-stream') {
        // Streaming ASR: OnlineRecognizer with partial results
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
          this.handleAsrResult(text);
        };

        engine.onError = (error) => {
          console.error('[LocalInference] Streaming ASR error:', error);
          this.handlers.onError?.(new Error(`ASR: ${error}`));
        };

        this.asrEngine = engine;
        await engine.init(config.asrModelId);
      } else {
        // Offline ASR: VAD + OfflineRecognizer
        const engine = new AsrEngine();

        engine.onResult = (result) => {
          if (this.disposed) return;
          const text = result.text.trim();
          if (!text) return;
          console.debug('[LocalInference] ASR result:', text, `(${result.durationMs}ms speech, ${result.recognitionTimeMs}ms recognition)`);
          this.handleAsrResult(text);
        };

        engine.onError = (error) => {
          console.error('[LocalInference] ASR error:', error);
          this.handlers.onError?.(new Error(`ASR: ${error}`));
        };

        this.asrEngine = engine;
        await engine.init(config.asrModelId, {
          threshold: config.vadThreshold,
          minSilenceDuration: config.vadMinSilenceDuration,
          minSpeechDuration: config.vadMinSpeechDuration,
        });
      }
      console.info('[LocalInference] ASR engine ready');

      // Initialize Translation engine
      console.info('[LocalInference] Initializing Translation engine:', config.sourceLanguage, '→', config.targetLanguage);
      this.translationEngine = new TranslationEngine();
      await this.translationEngine.init(config.sourceLanguage, config.targetLanguage);
      console.info('[LocalInference] Translation engine ready');

      // Initialize TTS engine (optional, degrades gracefully)
      if (config.ttsModelId) {
        try {
          console.info('[LocalInference] Initializing TTS engine:', config.ttsModelId);
          this.ttsEngine = new TtsEngine();
          await this.ttsEngine.init(config.ttsModelId);
          console.info('[LocalInference] TTS engine ready (sampleRate:', this.ttsEngine.sampleRate, ', speakers:', this.ttsEngine.numSpeakers, ')');
        } catch (error) {
          console.warn('[LocalInference] TTS init failed, continuing without TTS:', error);
          this.ttsEngine?.dispose();
          this.ttsEngine = null;
        }
      } else {
        console.info('[LocalInference] No TTS model configured, text-only mode');
      }

      this.connected = true;
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
    // No-op: pipeline is triggered by ASR results automatically
  }

  cancelResponse(_trackId?: string, _offset?: number): void {
    // No-op
  }

  getConversationItems(): ConversationItem[] {
    return [...this.conversationItems];
  }

  setEventHandlers(handlers: ClientEventHandlers): void {
    this.handlers = handlers;
  }

  getProvider(): ProviderType {
    return Provider.LOCAL_INFERENCE;
  }

  // ─── Pipeline ─────────────────────────────────────────────

  /**
   * Handle partial (interim) ASR result from streaming recognizer.
   * Creates or updates an in_progress user item with interim text.
   */
  private handlePartialAsrResult(text: string): void {
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

  private handleAsrResult(text: string): void {
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

    // Enqueue translation + TTS
    this.ttsQueue.push({ text });
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
    // Create assistant item (in_progress)
    const assistantItem: ConversationItem = {
      id: `local_asst_${++this.itemCounter}`,
      role: 'assistant',
      type: 'message',
      status: 'in_progress',
      createdAt: Date.now(),
      formatted: {},
    };
    this.conversationItems.push(assistantItem);

    try {
      // Translate
      if (!this.translationEngine || this.disposed) return;
      const translationResult = await this.translationEngine.translate(job.text);
      if (this.disposed) return;

      const translatedText = translationResult.translatedText;
      console.debug('[LocalInference] Translation:', job.text, '→', translatedText, `(${translationResult.inferenceTimeMs}ms)`);

      // Update assistant item with translation
      assistantItem.formatted!.transcript = translatedText;
      this.handlers.onConversationUpdated?.({ item: assistantItem });

      // TTS (optional)
      if (this.ttsEngine && this.config && !this.disposed) {
        try {
          const ttsResult = await this.ttsEngine.generate(
            translatedText,
            this.config.ttsSpeakerId,
            this.config.ttsSpeed,
          );
          if (this.disposed) return;

          console.debug('[LocalInference] TTS generated:', ttsResult.samples.length, 'samples @', ttsResult.sampleRate, 'Hz', `(${ttsResult.generationTimeMs}ms)`);

          // Resample to 24kHz and convert to Int16
          const resampled = resampleFloat32(ttsResult.samples, ttsResult.sampleRate, 24000);
          const int16Audio = float32ToInt16(resampled);

          // Send audio delta
          this.handlers.onConversationUpdated?.({
            item: assistantItem,
            delta: { audio: int16Audio },
          });
        } catch (ttsError) {
          console.warn('[LocalInference] TTS failed for text, continuing without audio:', ttsError);
        }
      }

      // Mark completed
      assistantItem.status = 'completed';
      this.handlers.onConversationUpdated?.({ item: assistantItem });

    } catch (error) {
      // Session ending — expected, not an error
      if (this.disposed) return;

      console.error('[LocalInference] Pipeline error:', error);

      // Create error item
      assistantItem.type = 'error';
      assistantItem.status = 'completed';
      assistantItem.formatted!.transcript = `Translation error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.handlers.onConversationUpdated?.({ item: assistantItem });
    }
  }
}
