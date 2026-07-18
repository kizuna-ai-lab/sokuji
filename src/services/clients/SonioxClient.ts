import {
  IClient,
  ConversationItem,
  SessionConfig,
  ClientEventHandlers,
  ApiKeyValidationResult,
  FilteredModel,
  ResponseConfig,
  SonioxSessionConfig
} from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';
import { SonioxSttStream, SonioxSttMessage, SonioxToken, SonioxTranslationConfig } from './SonioxSttStream';
import { SonioxTtsStream } from './SonioxTtsStream';
import { PcmMixer } from './PcmMixer';
import i18n from '../../locales';

/**
 * Soniox speech-to-speech translation client.
 *
 * Orchestrates two protocol components:
 * - SonioxSttStream: STT+translation (always on)
 * - SonioxTtsStream: spoken translation (only when !textOnly; best-effort —
 *   a TTS failure degrades the session to subtitles, never kills it)
 *
 * All Sokuji conversation semantics (items, finals-only feeding, <end>
 * segmentation) live here; the streams speak only the Soniox wire protocol.
 *
 * No-interruption rule: createResponse/cancelResponse are no-ops and
 * onConversationInterrupted is never fired — the translation stream is
 * continuous and AI output must never be cut by user audio.
 */

const STT_MODEL = 'stt-rt-v5';
const TTS_MODEL = 'tts-rt-v1';
const SAMPLE_RATE = 24000; // Sokuji mic pipeline and ModernAudioPlayer both run at 24 kHz
const AUTH_PROBE_URL = 'https://api.soniox.com/v1/auth/temporary-api-key';

export class SonioxClient implements IClient {
  private apiKey: string;
  private stt: SonioxSttStream | null = null;
  private tts: SonioxTtsStream | null = null;
  private eventHandlers: ClientEventHandlers = {};
  private conversationItems: ConversationItem[] = [];
  private isConnectedState = false;
  private instanceId: string;
  private currentConfig: SonioxSessionConfig | null = null;
  private bidirectional = false;
  // Both single-session: mixes appendInputAudio (channel A) with the
  // secondary port's appendParticipantAudio (channel B) into one STT stream.
  private mixer: PcmMixer | null = null;

  // Per-utterance display state
  private currentUserItemId: string | null = null;
  private currentAssistantItemId: string | null = null;
  private userFinal = '';
  private assistantFinal = '';
  // TTS language for the in-flight utterance (two_way: from the first final
  // translation token; one_way: always the target language)
  private utteranceTtsLanguage: string | null = null;
  private ttsFailedOnce = false;
  // Bidirectional only: which side (my language vs. the other's) the
  // in-flight utterance belongs to, derived from the first original token's
  // language (or the first translation token's source_language, if the
  // original arrived in an earlier already-flushed message). Reset on
  // <end> and in reset().
  private utteranceSide: 'speaker' | 'participant' | null = null;
  // Tracks which utterance's audio is currently streaming back from TTS.
  // Deliberately independent of currentAssistantItemId: text_end is sent on
  // <end> (which clears currentAssistantItemId), but the trailing audio for
  // that same utterance keeps arriving afterward — it must still land on the
  // completed utterance's item, not mint a new one.
  private audioItemId: string | null = null;
  // Snapshot of utteranceSide taken at the same moment audioItemId is
  // latched (in feedTts). TTS audio and STT text are independent async
  // streams: <end> resets the live utteranceSide to null, and the NEXT
  // utterance can re-latch a new one before this utterance's trailing audio
  // has finished arriving. emitAssistantAudio must tag with the side this
  // audio's utterance actually belonged to, not whatever utteranceSide is
  // live when the audio happens to show up.
  private audioItemSide: 'speaker' | 'participant' | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.instanceId = `soniox_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateItemId(type: string): string {
    return `${this.instanceId}_${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /** Validate the key with a cheap temporary-key probe (201 = valid). */
  static async validateApiKeyAndFetchModels(apiKey: string): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    if (!apiKey) {
      return {
        validation: { valid: false, message: i18n.t('settings.errorValidatingApiKey'), validating: false },
        models: []
      };
    }
    try {
      const response = await fetch(AUTH_PROBE_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 60 }),
      });
      if (response.status === 200 || response.status === 201) {
        return {
          validation: { valid: true, message: i18n.t('settings.apiKeyValidationCompleted'), validating: false },
          models: [{ id: STT_MODEL, type: 'realtime', created: Date.now() }]
        };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          validation: { valid: false, message: i18n.t('settings.invalidApiKeyFormat'), validating: false },
          models: []
        };
      }
      return {
        validation: { valid: false, message: `${i18n.t('settings.errorValidatingApiKey')}: HTTP ${response.status}`, validating: false },
        models: []
      };
    } catch (error: any) {
      return {
        validation: { valid: false, message: error.message || i18n.t('settings.errorValidatingApiKey'), validating: false },
        models: []
      };
    }
  }

  async connect(config: SessionConfig): Promise<void> {
    if (config.provider !== 'soniox') {
      throw new Error('Invalid session config for Soniox client');
    }
    this.currentConfig = config as SonioxSessionConfig;
    this.reset();

    const cfg = this.currentConfig;
    // two_way needs a concrete source; degrade to one_way on 'auto'
    // (the descriptor applies the same rule — this is the safety belt).
    const effectiveTwoWay = cfg.bidirectional && cfg.sourceLanguage !== 'auto';
    this.bidirectional = effectiveTwoWay;
    const translation: SonioxTranslationConfig = effectiveTwoWay
      ? { type: 'two_way', language_a: cfg.sourceLanguage, language_b: cfg.targetLanguage }
      : { type: 'one_way', target_language: cfg.targetLanguage };
    const languageHints = effectiveTwoWay
      ? [cfg.sourceLanguage, cfg.targetLanguage]
      : (cfg.sourceLanguage !== 'auto' ? [cfg.sourceLanguage] : undefined);

    this.stt = new SonioxSttStream();
    this.stt.setHandlers({
      onMessage: (message) => this.handleSttMessage(message),
      onError: (code, message) => this.handleSttError(code, message),
      onClose: (event) => {
        this.isConnectedState = false;
        this.emitRealtime('client', 'session.closed', { provider: 'soniox', ...event });
        this.eventHandlers.onClose?.(event);
      },
    });
    await this.stt.connect({
      apiKey: this.apiKey,
      model: cfg.model || STT_MODEL,
      sampleRate: SAMPLE_RATE,
      languageHints,
      translation,
    });
    this.isConnectedState = true;

    if (this.bidirectional) {
      this.mixer = new PcmMixer({
        frameSamples: Math.round(SAMPLE_RATE * 0.1),
        intervalMs: 100,
        maxBacklogSamples: SAMPLE_RATE * 2,
        onFrame: (mixed) => { if (this.stt?.isOpen()) this.stt.sendAudio(mixed); },
      });
      this.mixer.start();
    }

    if (!cfg.textOnly) {
      try {
        this.tts = new SonioxTtsStream({
          apiKey: this.apiKey,
          voice: cfg.voice || 'Maya',
          model: TTS_MODEL,
          sampleRate: SAMPLE_RATE,
        });
        this.tts.setHandlers({
          onAudio: (audio) => this.emitAssistantAudio(audio),
          onError: (code, message) => this.handleTtsError(code, message),
        });
        await this.tts.connect();
        this.tts.prewarm(cfg.targetLanguage);
      } catch (error) {
        // TTS is best-effort: never fail the session because audio is unavailable.
        console.error('[SonioxClient] TTS connect failed — continuing text-only:', error);
        this.emitRealtime('client', 'tts.degraded', { reason: String(error) });
        // The hardened stream may ALSO fire onError('socket_closed', ...) for
        // this same failure (e.g. a real underlying socket closing after the
        // connect() promise already rejected) — suppress that echo so we
        // don't log/emit tts.degraded twice for one failure.
        this.ttsFailedOnce = true;
        this.tts = null;
      }
    }

    this.emitRealtime('client', 'session.opened', {
      provider: 'soniox',
      translation,
      textOnly: !!cfg.textOnly,
    });
    this.eventHandlers.onOpen?.();
  }

  private handleSttMessage(message: SonioxSttMessage): void {
    const tokens = message.tokens ?? [];
    this.emitDebugLog(tokens);

    // Partials are re-sent in full on every message: rebuild them each time.
    let userPartial = '';
    let assistantPartial = '';

    for (const token of tokens) {
      const text = token.text ?? '';
      if (text === '<fin>') continue;
      if (text === '<end>') {
        this.finishUtterance();
        continue;
      }
      const isTranslation = token.translation_status === 'translation';
      if (this.bidirectional && this.utteranceSide === null) {
        const src = this.currentConfig?.sourceLanguage;
        if (!isTranslation && token.language) {
          this.utteranceSide = token.language === src ? 'speaker' : 'participant';
        } else if (isTranslation && token.source_language) {
          this.utteranceSide = token.source_language === src ? 'speaker' : 'participant';
        }
      }
      if (isTranslation) {
        if (token.is_final) {
          this.assistantFinal += text;
          this.feedTts(text, token);
        } else {
          assistantPartial += text;
        }
      } else {
        if (token.is_final) {
          this.userFinal += text;
        } else {
          userPartial += text;
        }
      }
    }

    this.emitTextUpdate('user', this.userFinal, userPartial);
    this.emitTextUpdate('assistant', this.assistantFinal, assistantPartial);
  }

  private feedTts(text: string, token: SonioxToken): void {
    if (!this.tts) return;
    if (this.bidirectional && token.source_language !== this.currentConfig?.sourceLanguage) return; // v1: only me→other is spoken
    if (this.utteranceTtsLanguage === null) {
      this.utteranceTtsLanguage = token.language || this.currentConfig?.targetLanguage || 'en';
    }
    // Mint (or reuse) this utterance's assistant item id up front, and pin it
    // as the audio target — audio for this utterance keeps arriving after
    // <end> clears currentAssistantItemId, so it needs its own anchor.
    // Snapshot the CURRENT utterance's side alongside it: utteranceSide is
    // live state that a following utterance can overwrite before this
    // utterance's trailing audio finishes arriving (see audioItemSide doc).
    this.audioItemId = this.ensureItem('assistant').id;
    this.audioItemSide = this.utteranceSide;
    this.tts.sendText(text, this.utteranceTtsLanguage);
  }

  /**
   * Mint-if-needed placeholder ConversationItem for a role's current
   * utterance side, pushing it into `conversationItems` immediately so it's
   * listed (and thus visible — MainPanel renders exclusively from
   * `getConversationItems()`) before any text has arrived for it. Returns
   * the existing item as-is if one is already tracked; never mutates it —
   * callers that need to update its content go through `upsertItem`
   * instead, which always builds a fresh object so a snapshot already
   * handed to an onConversationUpdated listener is never rewritten out from
   * under it by a later update.
   *
   * Looks the id up in `conversationItems` itself (not a separate cache) so
   * that if the array is externally truncated (clearConversationItems())
   * mid-utterance, the next call self-heals by minting a fresh id/item
   * instead of resuming a detached object that would never be visible
   * again.
   */
  private ensureItem(role: 'user' | 'assistant'): ConversationItem {
    const currentId = role === 'user' ? this.currentUserItemId : this.currentAssistantItemId;
    const existing = currentId ? this.conversationItems.find((i) => i.id === currentId) : undefined;
    if (existing) return existing;
    const id = this.generateItemId(role);
    if (role === 'user') this.currentUserItemId = id; else this.currentAssistantItemId = id;
    const item: ConversationItem = {
      id,
      role,
      type: 'message',
      status: 'in_progress',
      createdAt: Date.now(),
      formatted: { text: '', transcript: '' },
      content: [{ type: 'text', text: '' }],
    };
    this.conversationItems.push(item);
    return item;
  }

  /**
   * Build a fresh ConversationItem carrying `patch` and store it — replacing
   * the `conversationItems` entry for `currentId` in place if one is
   * tracked there (self-healing to a freshly minted id/entry if `currentId`
   * doesn't resolve, e.g. after an external clearConversationItems()), or
   * appending a new one. Deliberately never mutates the previous item
   * object, so a reference already emitted to an onConversationUpdated
   * listener stays a frozen snapshot of that moment.
   */
  private upsertItem(
    role: 'user' | 'assistant',
    currentId: string | null,
    patch: Pick<ConversationItem, 'status' | 'formatted' | 'content'>
  ): ConversationItem {
    const idx = currentId ? this.conversationItems.findIndex((i) => i.id === currentId) : -1;
    const previous = idx !== -1 ? this.conversationItems[idx] : undefined;
    const item: ConversationItem = {
      id: previous?.id ?? currentId ?? this.generateItemId(role),
      role,
      type: 'message',
      createdAt: previous?.createdAt ?? Date.now(),
      ...patch,
    };
    if (idx !== -1) this.conversationItems[idx] = item; else this.conversationItems.push(item);
    return item;
  }

  /** Update the in-progress item for one side of the pair. */
  private emitTextUpdate(role: 'user' | 'assistant', finalText: string, partialText: string): void {
    const text = finalText + partialText;
    if (!text) return;
    const currentId = role === 'user' ? this.currentUserItemId : this.currentAssistantItemId;
    const item = this.upsertItem(role, currentId, {
      status: 'in_progress',
      formatted: { text, transcript: text },
      content: [{ type: 'text', text }],
    });
    if (this.bidirectional && this.utteranceSide) item.source = this.utteranceSide;
    if (role === 'user') this.currentUserItemId = item.id; else this.currentAssistantItemId = item.id;
    this.eventHandlers.onConversationUpdated?.({ item, delta: { text } });
  }

  /** <end>: complete both sides' stored items, reset per-utterance state. */
  private finishUtterance(): void {
    const complete = (role: 'user' | 'assistant', existingId: string | null, text: string) => {
      if (!text) return;
      // <end> can arrive in the same STT message as the finals that complete
      // it — before the post-loop emitTextUpdate() has ever assigned an item
      // id for this batch (e.g. a user-side final with no preceding TTS
      // mint). upsertItem() mints+lists one lazily rather than dropping the
      // completed item.
      const item = this.upsertItem(role, existingId, {
        status: 'completed',
        formatted: { text, transcript: text },
        content: [{ type: 'text', text }],
      });
      if (this.bidirectional && this.utteranceSide) item.source = this.utteranceSide;
      this.eventHandlers.onConversationUpdated?.({ item, delta: {} });
    };
    complete('user', this.currentUserItemId, this.userFinal);
    complete('assistant', this.currentAssistantItemId, this.assistantFinal);
    this.currentUserItemId = null;
    this.currentAssistantItemId = null;
    // audioItemId is intentionally NOT cleared here: trailing TTS audio for
    // this just-completed utterance keeps streaming in after <end> and must
    // still attach to it (MainPanel's audio-delta path ignores item status).
    this.userFinal = '';
    this.assistantFinal = '';
    this.utteranceTtsLanguage = null;
    this.utteranceSide = null;
    this.tts?.endUtterance();
  }

  /** TTS audio chunk → audio-only delta on the assistant item (MainPanel plays it). */
  private emitAssistantAudio(audio: Int16Array): void {
    // Pure-audio edge case that shouldn't happen in practice (audio always
    // follows feedTts, which sets audioItemId) — fall back to minting (and
    // listing) rather than dropping the chunk.
    if (!this.audioItemId) this.audioItemId = this.ensureItem('assistant').id;
    // keepReplayAudio (per-item formatted.audio accumulation for the inline
    // replay button) is deliberately NOT implemented in v1 — plan scopes it
    // out; live playback via the audio-only delta below is the v1 contract.
    // Never mutate the stored entry in place (same discipline as upsertItem):
    // build a fresh object and, if one was already tracked, replace it in
    // conversationItems rather than rewriting fields on the shared reference —
    // a snapshot already handed to an onConversationUpdated listener must stay
    // a frozen snapshot of that moment.
    const idx = this.conversationItems.findIndex((i) => i.id === this.audioItemId);
    const previous = idx !== -1 ? this.conversationItems[idx] : undefined;
    const item: ConversationItem = {
      ...(previous ?? {
        id: this.audioItemId,
        role: 'assistant',
        type: 'message',
        status: 'in_progress',
        formatted: {},
      }),
    };
    if (this.bidirectional && this.audioItemSide) item.source = this.audioItemSide;
    if (idx !== -1) this.conversationItems[idx] = item;
    this.eventHandlers.onConversationUpdated?.({ item, delta: { audio } });
  }

  private handleSttError(code: string, message: string): void {
    console.error(`[SonioxClient] STT error ${code}: ${message}`);
    const errorItem: ConversationItem = {
      id: this.generateItemId('error'),
      role: 'system',
      type: 'error',
      status: 'completed',
      formatted: { text: `[Soniox ${code}] ${message}` },
      content: [{ type: 'text', text: message }],
    };
    this.conversationItems.push(errorItem);
    this.eventHandlers.onConversationUpdated?.({ item: errorItem });
    this.eventHandlers.onError?.({ code, message });
  }

  private handleTtsError(code: string, message: string): void {
    // TTS errors are non-fatal: log once, keep subtitles running.
    if (!this.ttsFailedOnce) {
      this.ttsFailedOnce = true;
      console.error(`[SonioxClient] TTS error ${code}: ${message} — spoken translation degraded`);
      this.emitRealtime('client', 'tts.degraded', { code, message });
    }
  }

  private emitRealtime(source: 'client' | 'server', type: string, data: unknown): void {
    this.eventHandlers.onRealtimeEvent?.({
      source,
      event: { type, data },
    } as any);
  }

  /**
   * Compact, groupable debug-timeline logging. Soniox re-sends the FULL
   * cumulative token list on every frame and interleaves empty keepalive
   * frames, so forwarding raw `message.received` payloads floods the timeline
   * with huge, unreadable, un-mergeable blobs. Instead:
   *  - empty keepalive/progress frames are dropped;
   *  - streaming partials emit one compact `stt.delta` (logStore collapses
   *    consecutive `.delta` events into a single counted group);
   *  - a finalized segment emits readable `stt.transcript` / `stt.translation`
   *    milestones (ungrouped);
   *  - an endpoint emits `stt.endpoint`.
   */
  private emitDebugLog(tokens: SonioxToken[]): void {
    if (tokens.length === 0) return; // skip empty keepalive/progress frames
    let transcript = '';
    let translation = '';
    let endpoint = false;
    let allFinal = true;
    let hasContent = false;
    for (const token of tokens) {
      const text = token.text ?? '';
      if (text === '<end>') { endpoint = true; continue; }
      if (text === '<fin>') continue;
      hasContent = true;
      if (!token.is_final) allFinal = false;
      if (token.translation_status === 'translation') translation += text;
      else transcript += text;
    }
    if (hasContent) {
      if (allFinal) {
        if (transcript) this.emitRealtime('server', 'stt.transcript', { text: transcript });
        if (translation) this.emitRealtime('server', 'stt.translation', { text: translation });
      } else {
        this.emitRealtime('server', 'stt.delta', { transcript, translation });
      }
    }
    if (endpoint) this.emitRealtime('server', 'stt.endpoint', {});
  }

  async disconnect(): Promise<void> {
    if (this.mixer) { this.mixer.stop(); this.mixer = null; }
    if (this.stt) {
      this.stt.end();   // empty text frame: server flushes and closes
      this.stt.close();
      this.stt = null;
    }
    if (this.tts) {
      this.tts.close();
      this.tts = null;
    }
    this.isConnectedState = false;
    this.emitRealtime('client', 'session.closed', { provider: 'soniox', reason: 'client_disconnect' });
    this.eventHandlers.onClose?.({});
  }

  isConnected(): boolean {
    return this.isConnectedState;
  }

  updateSession(_config: Partial<SessionConfig>): void {
    console.warn('[SonioxClient] Session updates are not supported. Reconnect to change configuration.');
  }

  reset(): void {
    if (this.mixer) { this.mixer.stop(); this.mixer = null; }
    this.conversationItems = [];
    this.currentUserItemId = null;
    this.currentAssistantItemId = null;
    this.audioItemId = null;
    this.audioItemSide = null;
    this.userFinal = '';
    this.assistantFinal = '';
    this.utteranceTtsLanguage = null;
    this.utteranceSide = null;
    this.ttsFailedOnce = false;
  }

  appendInputAudio(audioData: Int16Array): void {
    if (this.mixer) { this.mixer.pushA(audioData); return; }
    if (!this.stt?.isOpen()) return;
    this.stt.sendAudio(audioData);
  }

  /** Channel B feed for the Both single-session mixer (fed by the secondary port). */
  appendParticipantAudio(audioData: Int16Array): void {
    if (this.mixer) this.mixer.pushB(audioData);
  }

  /**
   * Second IClient reference for MainPanel's participant slot in Both single-session.
   * Its audio is channel B of this core's mixer; every other method is inert so the
   * core is driven solely by the primary (speaker) reference.
   */
  createSecondaryPort(): IClient {
    const core = this;
    return {
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => core.isConnected(),
      updateSession: () => {},
      reset: () => {},
      appendInputAudio: (d: Int16Array) => core.appendParticipantAudio(d),
      appendInputText: () => {},
      createResponse: () => {},
      cancelResponse: () => {},
      getConversationItems: () => [],
      clearConversationItems: () => {},
      setEventHandlers: () => {},
      getProvider: () => core.getProvider(),
    };
  }

  appendInputText(_text: string): void {
    console.warn('[SonioxClient] Text input is not supported for speech translation');
  }

  // Continuous streaming: responses are generated automatically by the server.
  createResponse(_config?: ResponseConfig): void { /* no-op by design */ }
  cancelResponse(_trackId?: string, _offset?: number): void { /* no-op by design (no-interruption rule) */ }

  getConversationItems(): ConversationItem[] {
    return [...this.conversationItems];
  }

  clearConversationItems(): void {
    this.conversationItems = [];
  }

  setEventHandlers(handlers: ClientEventHandlers): void {
    this.eventHandlers = { ...handlers };
  }

  getProvider(): ProviderType {
    return Provider.SONIOX;
  }
}
