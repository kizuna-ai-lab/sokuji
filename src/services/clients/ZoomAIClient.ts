import {
  IClient, SessionConfig, ClientEventHandlers, ConversationItem,
  ResponseConfig, ApiKeyValidationResult, FilteredModel,
  ZoomAISessionConfig, isZoomAISessionConfig,
} from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';
import { ZoomJwtSigner } from './zoom/ZoomJwtSigner';
import { encodeWavDataUri, transcribe, translate, ZoomApiError } from './zoom/zoomApi';
import { createVadWorker } from './zoom/createVadWorker';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';
import { punctuateAndSplitDefinite } from './punctuateDefinite';

const VAD_INPUT_SAMPLE_RATE = 24000; // Sokuji recorder output

export class ZoomAIClient implements IClient {
  private signer: ZoomJwtSigner;
  private worker: Worker | null = null;
  private eventHandlers: ClientEventHandlers = {};
  private conversationItems: ConversationItem[] = [];
  private currentConfig: ZoomAISessionConfig | null = null;
  private connected = false;
  private instanceId: string;
  private itemCounter = 0;
  private utteranceChain: Promise<void> = Promise.resolve();

  // ----- Sentence segmentation stage -----
  //
  // Both come from ClientOptions and are never re-read from a store. One REST
  // utterance is one segment and the VAD decided where it ended, so the stage
  // fills in punctuation Zoom never sent and, at a size of 1-5, cuts inside
  // that boundary — see punctuateAndSplitDefinite.
  // No lane is needed here: `utteranceChain` already runs one utterance at a
  // time, so these awaits are ordered by construction.
  private segmentation: SegmentationRuntime | null = null;
  private sentencesPerChunk = 3;
  /**
   * R2: the session's one answer, frozen in connect() and cleared in
   * disconnect(). `runtime.enabled` moves in BOTH directions under an open
   * session, and a session that started without the models must not begin
   * punctuating halfway through.
   */
  private sessionSegmentation: SegmentationRuntime | null = null;

  constructor(
    apiKey: string,
    apiSecret: string,
    options: { segmentation?: SegmentationRuntime | null; sentencesPerChunk?: number } = {},
  ) {
    this.signer = new ZoomJwtSigner(apiKey, apiSecret);
    this.segmentation = options.segmentation ?? null;
    this.sentencesPerChunk = options.sentencesPerChunk ?? 3;
    this.instanceId = `zoom_ai_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private nextId(kind: string): string {
    return `${this.instanceId}_${kind}_${++this.itemCounter}`;
  }

  async connect(config: SessionConfig): Promise<void> {
    if (!isZoomAISessionConfig(config)) {
      throw new Error('Invalid session config for Zoom AI client');
    }
    this.currentConfig = config;
    this.conversationItems = [];
    // R2: the one read of `enabled` this session gets. See the
    // `sessionSegmentation` field doc.
    const runtime = this.segmentation;
    this.sessionSegmentation = runtime?.enabled === true
      ? {
          enabled: true,
          punctuate: (lang, text, opts) => runtime.punctuate(lang, text, opts),
          // Forwarded so the stage's own counters survive the freeze: this view
          // is what SentenceStream and punctuateDefinite report through, and
          // dropping it here would make every seal invisible. Counts, never text.
          observe: (event) => runtime.observe?.(event),
        }
      : null;

    await new Promise<void>((resolve, reject) => {
      const worker = createVadWorker();
      if (!worker) { this.connected = true; resolve(); return; } // test/no-worker env
      this.worker = worker;
      const timer = setTimeout(() => reject(new Error('VAD worker init timeout')), 15000);
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'ready') {
          clearTimeout(timer);
          this.connected = true;
          this.eventHandlers.onOpen?.();
          resolve();
        } else if (msg.type === 'speech_start') {
          this.eventHandlers.onRealtimeEvent?.({ source: 'client', event: { type: 'zoom.speech_start', data: {} } });
        } else if (msg.type === 'utterance') {
          this.utteranceChain = this.utteranceChain
            .then(() => this.handleUtterance(msg.audio as Float32Array))
            .catch(() => {});
        } else if (msg.type === 'error') {
          if (!this.connected) {
            clearTimeout(timer);
            reject(new Error(msg.message));
          } else {
            this.eventHandlers.onError?.(new Error(msg.message));
          }
        }
      };
      worker.onerror = (err) => { clearTimeout(timer); reject(err); };
      // Resolve ORT wasm + Silero model on the MAIN thread (self.location is
      // unreliable across Electron/extension/web) — same pattern as AsrEngine.
      worker.postMessage({
        type: 'init',
        ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
        vadModelUrl: new URL('./wasm/vad/silero_vad_v5.onnx', window.location.href).href,
      });
    });
  }

  private async handleUtterance(audio: Float32Array): Promise<void> {
    const cfg = this.currentConfig;
    if (!cfg || !this.connected) return;
    const target = cfg.targetLanguages[0];
    if (!target) { this.emitError(new Error('No target language configured')); return; }
    try {
      const token = await this.signer.getToken();
      if (!this.connected) return;
      const wav = encodeWavDataUri(audio, 16000);
      const rawTranscript = await transcribe(token, wav, cfg.sourceLanguage);
      if (!rawTranscript || !this.connected) return;
      // Fill in punctuation Zoom's transcription did not send. Awaited inline:
      // this whole method already runs one utterance at a time on
      // `utteranceChain`, so there is no way for a later utterance's item to
      // overtake this one. `this.connected` below is the teardown guard the
      // rest of the method already uses.
      //
      // The `!runtime` branch is the same guard the other four split-capable
      // clients carry, and it is load-bearing: `sentencesPerChunk` is the
      // resolved size and arrives whatever the mode is, so without it a
      // session with the stage OFF would still be cut into one bubble per N
      // sentences by `splitDefinite`, which does not consult the runtime.
      const runtime = this.segmentationFor();
      const transcriptPieces = runtime
        ? await punctuateAndSplitDefinite(runtime, cfg.sourceLanguage, rawTranscript, this.sentencesPerChunk)
        : [rawTranscript];
      if (!this.connected) return;

      this.writePieces('user', transcriptPieces);

      if (!this.connected) return;
      // The RAW transcript, not the punctuated one: the stage changes what the
      // user reads, never what a provider is asked to translate.
      const rawTranslation = await translate(token, rawTranscript, cfg.sourceLanguage, target);
      if (!rawTranslation || !this.connected) return;
      // Re-read rather than reusing `runtime`: disconnect() may have landed
      // during the translate call, and the same off-means-off guard applies.
      const stillOn = this.segmentationFor();
      const translatedPieces = stillOn
        ? await punctuateAndSplitDefinite(stillOn, target, rawTranslation, this.sentencesPerChunk)
        : [rawTranslation];
      if (!this.connected) return;

      this.writePieces('assistant', translatedPieces);
    } catch (err) {
      if (this.connected) this.emitError(err);
    }
  }

  /**
   * One utterance's text, as one item per piece.
   *
   * A2's revision of D6 lets a size of 1-5 cut inside the boundary the VAD
   * chose; Auto, and an utterance with too few sentences, hand this one piece
   * and it is the write this client has always done. No Zoom item carries
   * audio — the WAV goes to the REST call and is never attached to an item —
   * so a cut strands no timing.
   *
   * ONE stamp for every piece. MainPanel sorts by `createdAt` with
   * `Array.prototype.sort`, which is stable, and these writes are contiguous
   * in `conversationItems`, so a shared key keeps the pieces together and the
   * next segment after them. A per-piece `createdAt + i` would instead give
   * piece *i* of the transcript and piece *i* of the translation the same key
   * whenever the two land within a millisecond of each other, and the sort
   * would interleave them.
   */
  private writePieces(role: 'user' | 'assistant', pieces: string[]): void {
    const createdAt = Date.now();
    pieces.forEach((text) => {
      const item: ConversationItem = {
        id: this.nextId(role === 'user' ? 'user' : 'asst'),
        role,
        type: 'message',
        status: 'completed',
        createdAt,
        formatted: { transcript: text, text },
        content: [{ type: 'text', text }],
      };
      this.conversationItems.push(item);
      this.eventHandlers.onConversationUpdated?.({ item });
    });
  }

  /** The session's frozen runtime, or null once the session is over. */
  private segmentationFor(): SegmentationRuntime | null {
    return this.connected ? this.sessionSegmentation : null;
  }

  private emitError(err: unknown): void {
    const message = err instanceof ZoomApiError
      ? `[Zoom ${err.status}${err.reason ? ` ${err.reason}` : ''}] ${err.message}`
      : (err as Error)?.message ?? String(err);
    const errorItem: ConversationItem = {
      id: this.nextId('error'), role: 'system', type: 'error', status: 'completed',
      createdAt: Date.now(),
      formatted: { text: message }, content: [{ type: 'text', text: message }],
    };
    this.conversationItems.push(errorItem);
    this.eventHandlers.onConversationUpdated?.({ item: errorItem });
    this.eventHandlers.onError?.(err);
  }

  appendInputAudio(audioData: Int16Array): void {
    if (!this.worker || !this.connected) return;
    // Copy so the transferable buffer is not detached from the caller's view.
    const pcm = new Int16Array(audioData);
    this.worker.postMessage({ type: 'audio', pcm, sampleRate: VAD_INPUT_SAMPLE_RATE }, [pcm.buffer]);
  }

  createResponse(_config?: ResponseConfig): void {
    this.worker?.postMessage({ type: 'flush' }); // PTT key-release: flush pending utterance
  }

  cancelResponse(_trackId?: string, _offset?: number): void {
    // Nothing streamed to cancel; utterances complete atomically.
  }

  appendInputText(_text: string): void {
    // Unreachable: MainPanel gates text input on capabilities.supportsTextInput.
  }

  async disconnect(): Promise<void> {
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' });
      this.worker.terminate();
      this.worker = null;
    }
    this.connected = false;
    // `segmentationFor()` already reads `connected`; dropping the frozen view
    // too means a reconnect cannot be served the old session's answer.
    this.sessionSegmentation = null;
    this.eventHandlers.onClose?.({});
  }

  isConnected(): boolean { return this.connected; }

  updateSession(_config: Partial<SessionConfig>): void {
    // Unreachable: no capability advertises runtime session updates.
  }

  reset(): void { this.conversationItems = []; this.itemCounter = 0; }
  getConversationItems(): ConversationItem[] { return [...this.conversationItems]; }
  clearConversationItems(): void { this.conversationItems = []; }
  setEventHandlers(handlers: ClientEventHandlers): void { this.eventHandlers = { ...handlers }; }
  getProvider(): ProviderType { return Provider.ZOOM_AI; }

  static async validateApiKeyAndFetchModels(
    apiKey: string,
    apiSecret: string,
  ): Promise<{ validation: ApiKeyValidationResult; models: FilteredModel[] }> {
    if (!apiKey || !apiSecret) {
      return { validation: { valid: false, message: '', validating: false }, models: [] };
    }
    try {
      const signer = new ZoomJwtSigner(apiKey, apiSecret);
      const token = await signer.getToken();
      // Cheapest reachable call that exercises auth + plan: a tiny translate.
      await translate(token, 'test', 'en-US', 'zh-CN');
      return {
        validation: { valid: true, message: 'API key validated', validating: false },
        models: [{ id: 'zoom-scribe-translator-v1', type: 'realtime', created: Date.now() }],
      };
    } catch (err) {
      const message = err instanceof ZoomApiError
        ? `${err.status}${err.reason ? ` ${err.reason}` : ''}: ${err.message}`
        : (err as Error)?.message ?? 'Validation failed';
      return { validation: { valid: false, message, validating: false }, models: [] };
    }
  }
}
