import {
  IClient, SessionConfig, ClientEventHandlers, ConversationItem,
  ResponseConfig, ApiKeyValidationResult, FilteredModel,
  ZoomAISessionConfig, isZoomAISessionConfig,
} from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';
import { ZoomJwtSigner } from './zoom/ZoomJwtSigner';
import { encodeWavDataUri, transcribe, translate, ZoomApiError } from './zoom/zoomApi';
import { createVadWorker } from './zoom/createVadWorker';

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

  constructor(apiKey: string, apiSecret: string) {
    this.signer = new ZoomJwtSigner(apiKey, apiSecret);
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
          void this.handleUtterance(msg.audio as Float32Array);
        } else if (msg.type === 'error') {
          this.eventHandlers.onError?.(new Error(msg.message));
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
    if (!cfg) return;
    const target = cfg.targetLanguages[0];
    try {
      const token = await this.signer.getToken();
      const wav = encodeWavDataUri(audio, 16000);
      const transcriptText = await transcribe(token, wav, cfg.sourceLanguage);
      if (!transcriptText) return;

      const userItem: ConversationItem = {
        id: this.nextId('user'), role: 'user', type: 'message', status: 'completed',
        createdAt: Date.now(),
        formatted: { transcript: transcriptText, text: transcriptText },
        content: [{ type: 'text', text: transcriptText }],
      };
      this.conversationItems.push(userItem);
      this.eventHandlers.onConversationUpdated?.({ item: userItem });

      const translated = await translate(token, transcriptText, cfg.sourceLanguage, target);
      if (!translated) return;

      const asstItem: ConversationItem = {
        id: this.nextId('asst'), role: 'assistant', type: 'message', status: 'completed',
        createdAt: Date.now(),
        formatted: { transcript: translated, text: translated },
        content: [{ type: 'text', text: translated }],
      };
      this.conversationItems.push(asstItem);
      this.eventHandlers.onConversationUpdated?.({ item: asstItem });
    } catch (err) {
      this.emitError(err);
    }
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
    console.warn('[ZoomAIClient] Text input is not supported');
  }

  async disconnect(): Promise<void> {
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' });
      this.worker.terminate();
      this.worker = null;
    }
    this.connected = false;
    this.eventHandlers.onClose?.({});
  }

  isConnected(): boolean { return this.connected; }

  updateSession(_config: Partial<SessionConfig>): void {
    console.warn('[ZoomAIClient] Session updates are not supported. Reconnect to change languages.');
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
