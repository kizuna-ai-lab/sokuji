import type { IClient, SessionConfig, ConversationItem, ClientEventHandlers, ResponseConfig } from '../interfaces/IClient';
import { isLocalNativeSessionConfig } from '../interfaces/IClient';
import type { ProviderType } from '../../types/Provider';
import { Provider } from '../../types/Provider';
import { NativeAsrClient } from '../../lib/local-inference/native/NativeAsrClient';
import { NativeTranslateClient } from '../../lib/local-inference/native/NativeTranslateClient';
import { NativeTtsClient } from '../../lib/local-inference/native/NativeTtsClient';
import { resampleFloat32, float32ToInt16 } from '../../utils/audio-conversion';
import { reconcileTtsVoice } from '../../lib/local-inference/native/nativeTtsVoiceReconciliation';
import { listNativeVoices, getNativeVoice } from '../../lib/local-inference/nativeVoiceStorage';
import { splitSentences } from '../../utils/splitSentences';
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
  private ttsStreaming = false;
  private ttsSpeed = 1.0;
  private keepReplayAudio: boolean = false;
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
    this.keepReplayAudio = config.keepReplayAudio ?? false;
    const store = useNativeModelStore.getState();
    const initTranslate = async () => {
      const tr = await this.translate.init(
        config.sourceLanguage, config.targetLanguage, config.translationModelId, config.translationDevice,
        config.asrModelId, config.ttsModelId, config.translationVariant,
      );
      store.setTranslationResolved({ model: config.translationModelId ?? '', device: tr.device ?? 'cpu', tokensPerSec: tr.tokensPerSec, memoryBytes: tr.memoryBytes, fallbackReason: tr.fallbackReason });
    };
    const initAsr = async () => {
      store.setAsrLoading(true);
      try {
        const res = await this.asr.init(config.sourceLanguage, config.asrModelId, 24000, {
          threshold: config.vadThreshold,
          minSilence: config.vadMinSilenceDuration,
          minSpeech: config.vadMinSpeechDuration,
        }, config.asrDevice);
        store.setAsrResolved({ model: config.asrModelId, device: res.device ?? 'cpu', rtf: res.rtf, memoryBytes: res.memoryBytes, fallbackReason: res.fallbackReason });
      } finally {
        store.setAsrLoading(false);
      }
    };
    // Load the GPU-priority stage first so it claims VRAM before the flexible
    // stage. With two Auto models that can't co-reside (e.g. a GPU-only Voxtral +
    // a 2B Qwen translation), whoever loads first wins the card; the flexible
    // model then degrades to CPU instead of the GPU-only one hard-failing.
    if (this.asrLoadsFirst(config.asrModelId, config.translationModelId ?? '')) {
      await initAsr();
      await initTranslate();
    } else {
      await initTranslate();
      await initAsr();
    }
    // Enable native TTS for piper (one-shot) and MOSS (streaming/cloning). Pocket
    // voice-cloning stays off until the Plan B reference-voice UX.
    this.ttsEnabled = !!config.ttsModelId && !config.textOnly
      && !String(config.ttsModelId).includes('pocket');
    if (this.ttsEnabled) {
      store.setTtsLoading(true);
      try {
        const r = await this.tts.init(config.ttsModelId, config.ttsDevice);
        this.ttsStreaming = !!r.streaming;
        store.setTtsResolved({ model: config.ttsModelId!, device: r.device ?? 'cpu',
          rtf: r.rtf, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason });
        // Apply the selected voice (next-session semantics). Custom ids resolve
        // against the stored library; a missing/deleted custom voice reconciles
        // back to the per-language default. Storage failure degrades to built-in
        // voices only (it must not kill TTS), so it is caught locally.
        let customIds: number[] = [];
        try {
          customIds = (await listNativeVoices()).map((v) => v.id);
        } catch { /* storage unavailable → built-in voices only */ }
        const voice = reconcileTtsVoice(config.ttsVoice ?? '', customIds, config.targetLanguage);
        if (voice.startsWith('builtin:')) {
          await this.tts.setVoice?.(voice.slice('builtin:'.length));
        } else if (voice.startsWith('custom:')) {
          const id = Number(voice.slice('custom:'.length));
          const stored = await getNativeVoice(id);
          if (stored) await this.tts.setReferenceVoice(new Float32Array(stored.audio), stored.sampleRate);
        }
      } catch (e) {
        this.ttsEnabled = false;
        this.handlers.onError?.(`native TTS init failed: ${e}`);
      } finally {
        store.setTtsLoading(false);
      }
    }
    this.connected = true;
    this.emitEvent('local.native.init.ready', 'client', { ttsEnabled: this.ttsEnabled });
    this.handlers.onOpen?.();
  }

  /**
   * Decide which stage loads first so the model that most needs the GPU claims
   * VRAM before the other. A model is "GPU-only" when the sidecar catalog lists
   * tiers for it but none is `cpu` (e.g. Voxtral) — that stage MUST get the GPU,
   * so it goes first. When both or neither are GPU-only, the larger model (by
   * download size) leads. Falls back to ASR-first when catalog/size data isn't
   * loaded yet — ASR is the only stage that can be GPU-only today, so leading
   * with it is the safe default. Never throws; ordering is best-effort.
   */
  private asrLoadsFirst(asrId: string, translationId: string): boolean {
    try {
      const { catalog, sizes } = useNativeModelStore.getState();
      const gpuOnly = (id: string): boolean => {
        const info = catalog[id];
        return !!info && info.tiers.length > 0 && !info.tiers.some((t) => t.tier === 'cpu');
      };
      const asrGpuOnly = gpuOnly(asrId);
      const trGpuOnly = gpuOnly(translationId);
      if (asrGpuOnly !== trGpuOnly) return asrGpuOnly;
      return (sizes[asrId] ?? 0) >= (sizes[translationId] ?? 0);
    } catch {
      return true;
    }
  }

  private nextId(p: string): string { return `${p}_${Date.now()}_${++this.idCounter}`; }

  private emit(item: ConversationItem, delta?: any): void {
    this.handlers.onConversationUpdated?.({ item, delta });
  }

  /** Mirror the LocalInferenceClient logging contract so events reach the Logs panel. */
  private emitEvent(type: string, source: 'client' | 'server', data: Record<string, any> = {}): void {
    this.handlers.onRealtimeEvent?.({ source, event: { type, data } } as any);
  }

  /**
   * Accumulate a TTS audio chunk onto the item so the inline replay button has
   * a complete buffer. Gated on `keepReplayAudio`; real-time playback (via the
   * audio delta) is unaffected when this is skipped.
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
      const displayText = tr.translatedText;
      const sentences = splitSentences(displayText, this.cfg?.targetLanguage);
      item.formatted!.audioSegments = [];
      let searchFrom = 0;
      let cumulativeAudioDuration = 0;

      for (const sentence of sentences) {
        if (!sentence.trim()) continue;

        const pos = displayText.indexOf(sentence, searchFrom);
        const textEnd = pos >= 0 ? pos + sentence.length : searchFrom + sentence.length;
        searchFrom = textEnd;

        try {
          if (this.ttsStreaming) {
            // Pre-set audioTextEnd so every chunk delta already carries current karaoke
            // metadata — mirrors LocalInferenceClient streaming path (LIC line 647).
            item.formatted!.audioTextEnd = textEnd;
            let chunkSampleCount = 0;
            await this.tts.generate(sentence, this.ttsSpeed, (pcm: Float32Array) => {
              const int16 = float32ToInt16(resampleFloat32(pcm, 24000, 24000));
              chunkSampleCount += int16.length;
              if (this.keepReplayAudio) this.appendItemAudio(item, int16);
              this.emit(item, { audio: int16 });
            });
            cumulativeAudioDuration += chunkSampleCount / 24000;
            item.formatted!.audioSegments.push({ textEnd, audioEnd: cumulativeAudioDuration });
            // Bare emit (no delta) publishes finalized segment metadata to the renderer
            // — mirrors LocalInferenceClient line 687: onConversationUpdated({ item }).
            this.emit(item);
          } else {
            // Set audioTextEnd before generate so metadata is current when the audio
            // delta fires — mirrors LocalInferenceClient non-streaming path (LIC line 713).
            item.formatted!.audioTextEnd = textEnd;
            const res = await this.tts.generate(sentence, this.ttsSpeed);
            const int16 = float32ToInt16(resampleFloat32(res.samples as Float32Array, res.sampleRate, 24000));
            cumulativeAudioDuration += int16.length / 24000;
            item.formatted!.audioSegments.push({ textEnd, audioEnd: cumulativeAudioDuration });
            if (this.keepReplayAudio) this.appendItemAudio(item, int16);
            this.emit(item, { audio: int16 });
          }
        } catch (ttsError) {
          // Mirror LocalInferenceClient lines 751-757: log + skip failed sentence,
          // loop continues so the item still reaches status='completed'.
          console.warn('[LocalNative] TTS failed for sentence, skipping:', ttsError);
          this.emitEvent('local.native.tts.error', 'client', {
            error: ttsError instanceof Error ? ttsError.message : String(ttsError),
          });
        }
      }

      // Ensure trailing whitespace is covered
      item.formatted!.audioTextEnd = displayText.length;
      this.emitEvent('local.native.tts.end', 'server', { samples: Math.round(cumulativeAudioDuration * 24000) });
    }
    item.status = 'completed';
    this.emit(item);
  }

  appendInputAudio(audioData: Int16Array): void { if (this.connected) this.asr.feedAudio(audioData, 24000); }
  appendInputText(text: string): void { this.onAsrResult({ text }); }
  createResponse(_config?: ResponseConfig): void { this.asr.flush?.(); }
  cancelResponse(): void { try { this.tts?.cancel?.(); } catch (_) {} }
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
