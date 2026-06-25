import type { IClient, SessionConfig, ConversationItem, ClientEventHandlers, ResponseConfig } from '../interfaces/IClient';
import { isLocalNativeSessionConfig } from '../interfaces/IClient';
import type { ProviderType } from '../../types/Provider';
import { Provider } from '../../types/Provider';
import { NativeAsrClient } from '../../lib/local-inference/native/NativeAsrClient';
import { NativeTranslateClient } from '../../lib/local-inference/native/NativeTranslateClient';
import { NativeTtsClient } from '../../lib/local-inference/native/NativeTtsClient';
import { resampleFloat32, float32ToInt16 } from '../../utils/audio-conversion';
import { useNativeModelStore } from '../../stores/nativeModelStore';

interface Deps {
  asr?: NativeAsrClient | any;
  translate?: NativeTranslateClient | any;
  tts?: NativeTtsClient | any;
}

/**
 * IClient for the native (Electron sidecar) provider. Orchestrates the native
 * WS clients into the session's ConversationItem pipeline: ASR → translation,
 * with TTS optional (native TTS today is Pocket/voice-cloning and needs a
 * reference clip, so the MVP is text-only). Does not touch LocalInferenceClient.
 */
export class LocalNativeClient implements IClient {
  private asr: any;
  private translate: any;
  private tts: any;
  private handlers: ClientEventHandlers = {};
  private items: ConversationItem[] = [];
  private connected = false;
  private idCounter = 0;
  private cfg: any = null;
  private ttsEnabled = false;
  private ttsSpeed = 1.0;
  private queue: Promise<void> = Promise.resolve();
  private partialUserItem: ConversationItem | null = null;

  constructor(deps: Deps = {}) {
    this.asr = deps.asr ?? new NativeAsrClient();
    this.translate = deps.translate ?? new NativeTranslateClient();
    this.tts = deps.tts ?? new NativeTtsClient();
  }

  async connect(config: SessionConfig): Promise<void> {
    if (!isLocalNativeSessionConfig(config)) throw new Error('LocalNativeClient requires a local_native config');
    this.cfg = config;
    this.asr.onResult = (r: any) => this.onAsrResult(r);
    this.asr.onPartialResult = (text: string) => this.onAsrPartial(text);
    this.asr.onError = (e: string) => this.handlers.onError?.(e);
    this.translate.onError = (e: string) => this.handlers.onError?.(e);
    this.emitEvent('local.native.init.start', 'client', {
      asr: config.asrModelId, translation: config.translationModelId, tts: config.ttsModelId,
      sourceLanguage: config.sourceLanguage, targetLanguage: config.targetLanguage,
    });
    this.ttsSpeed = config.ttsSpeed ?? 1.0;
    const tr = await this.translate.init(
      config.sourceLanguage, config.targetLanguage, config.translationModelId, config.translationDevice);
    const store = useNativeModelStore.getState();
    store.setTranslationResolved({ model: config.translationModelId ?? '', device: tr.device ?? 'cpu' });
    store.setAsrLoading(true);
    try {
      const res = await this.asr.init(config.sourceLanguage, config.asrModelId, 24000, {
        threshold: config.vadThreshold,
        minSilence: config.vadMinSilenceDuration,
        minSpeech: config.vadMinSpeechDuration,
      }, config.asrDevice);
      store.setAsrResolved({ model: config.asrModelId, device: res.device ?? 'cpu', rtf: res.rtf });
    } finally {
      store.setAsrLoading(false);
    }
    // Enable TTS for non-cloning models (e.g. sherpa piper). Cloning models
    // (Pocket) need a reference clip and stay off until a reference-voice UX.
    this.ttsEnabled = !!config.ttsModelId && !config.textOnly
      && !String(config.ttsModelId).includes('pocket');
    if (this.ttsEnabled) {
      try { await this.tts.init(config.ttsModelId); }
      catch (e) { this.ttsEnabled = false; this.handlers.onError?.(`native TTS init failed: ${e}`); }
    }
    this.connected = true;
    this.emitEvent('local.native.init.ready', 'client', { ttsEnabled: this.ttsEnabled });
    this.handlers.onOpen?.();
  }

  private nextId(p: string): string { return `${p}_${Date.now()}_${++this.idCounter}`; }

  private emit(item: ConversationItem, delta?: any): void {
    this.handlers.onConversationUpdated?.({ item, delta });
  }

  /** Mirror the LocalInferenceClient logging contract so events reach the Logs panel. */
  private emitEvent(type: string, source: 'client' | 'server', data: Record<string, any> = {}): void {
    this.handlers.onRealtimeEvent?.({ source, event: { type, data } } as any);
  }

  private onAsrPartial(text: string): void {
    if (!text) return;
    if (!this.partialUserItem) {
      this.partialUserItem = {
        id: this.nextId('user'), role: 'user', type: 'message', status: 'in_progress',
        createdAt: Date.now(), formatted: { transcript: text },
      };
      this.items.push(this.partialUserItem);
      this.emit(this.partialUserItem);
    } else {
      this.partialUserItem.formatted!.transcript = text;
      this.emit(this.partialUserItem, { transcript: text });
    }
  }

  private onAsrResult(r: { text: string }): void {
    if (!r.text?.trim()) return;
    this.emitEvent('local.native.asr.result', 'server', { text: r.text });
    let userItem = this.partialUserItem;
    if (userItem) {
      userItem.status = 'completed';
      userItem.formatted!.transcript = r.text;
      this.partialUserItem = null;
    } else {
      userItem = {
        id: this.nextId('user'), role: 'user', type: 'message', status: 'completed',
        createdAt: Date.now(), formatted: { transcript: r.text },
      };
      this.items.push(userItem);
    }
    this.emit(userItem);
    // serialize pipeline jobs so text/audio stay ordered
    this.queue = this.queue.then(() => this.runJob(r.text)).catch((e) => {
      this.emitEvent('local.native.error', 'client', { error: String(e) });
      this.handlers.onError?.(String(e));
    });
  }

  private async runJob(text: string): Promise<void> {
    this.emitEvent('local.native.translation.start', 'client', { text });
    const tr = await this.translate.translate(text, this.cfg?.instructions ?? '', !!this.cfg?.wrapTranscript);
    this.emitEvent('local.native.translation.end', 'server', { translatedText: tr.translatedText, inferenceTimeMs: tr.inferenceTimeMs });
    const item: ConversationItem = {
      id: this.nextId('asst'), role: 'assistant', type: 'message', status: 'in_progress',
      createdAt: Date.now(), formatted: { transcript: tr.translatedText },
    };
    this.items.push(item);
    this.emit(item);
    if (this.ttsEnabled) {
      this.emitEvent('local.native.tts.start', 'client', {});
      const res = await this.tts.generate(tr.translatedText, this.ttsSpeed);
      const int16 = float32ToInt16(resampleFloat32(res.samples, res.sampleRate, 24000));
      this.emitEvent('local.native.tts.end', 'server', { generationTimeMs: res.generationTimeMs, samples: int16.length });
      this.emit(item, { audio: int16 });
    }
    item.status = 'completed';
    this.emit(item);
  }

  appendInputAudio(audioData: Int16Array): void { if (this.connected) this.asr.feedAudio(audioData, 24000); }
  appendInputText(text: string): void { this.onAsrResult({ text }); }
  createResponse(_config?: ResponseConfig): void { this.asr.flush?.(); }
  cancelResponse(): void {}
  async disconnect(): Promise<void> {
    this.connected = false;
    this.partialUserItem = null;
    this.emitEvent('local.native.session.closed', 'client', { reason: 'user_disconnect' });
    this.asr.dispose?.(); this.translate.dispose?.(); this.tts.dispose?.();
    this.handlers.onClose?.({});
  }
  isConnected(): boolean { return this.connected; }
  updateSession(_config: Partial<SessionConfig>): void {}
  reset(): void { this.items = []; this.partialUserItem = null; }
  getConversationItems(): ConversationItem[] { return [...this.items]; }  // fresh ref so setItems() re-renders
  clearConversationItems(): void { this.items = []; this.partialUserItem = null; }  // drop the in-progress partial too, else the next final mutates a detached item
  setEventHandlers(handlers: ClientEventHandlers): void { this.handlers = handlers; }
  getProvider(): ProviderType { return Provider.LOCAL_NATIVE; }
}
