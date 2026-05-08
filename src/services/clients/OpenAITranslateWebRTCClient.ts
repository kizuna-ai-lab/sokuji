/**
 * OpenAITranslateWebRTCClient
 *
 * OpenAI gpt-realtime-translate client using WebRTC transport.
 *
 * Mirrors OpenAIWebRTCClient's structure (peer connection setup, ICE
 * gathering, data channel handshake, audio bridge wiring) but with three
 * translate-specific differences:
 *  1. Authentication uses EphemeralTokenService.mintTranslationClientSecret
 *     instead of getToken — translate has its own client_secrets endpoint.
 *  2. SDP exchange targets /v1/realtime/translations/calls (not /v1/realtime).
 *  3. Server events are handled by the same pairing state machine used by
 *     OpenAITranslateGAClient (input/output transcript deltas, output audio
 *     deltas, .done variants). Methods are copied verbatim from the GA
 *     client per spec — DRY refactor can come later once both transports
 *     have stabilized.
 *
 * Note: WebRTC delivers translated audio via a MediaStreamTrack that the
 * WebRTCAudioBridge converts to PCM and emits through onBufferedAudioData.
 * That PCM is attached to the current pair's assistant item so downstream
 * consumers (ModernAudioPlayer, conversation UI) see the same conversation-
 * update shape they get from the WebSocket transport's session.output_audio
 * deltas.
 */

import {
  IClient,
  ConversationItem,
  SessionConfig,
  ClientEventHandlers,
  OpenAITranslateSessionConfig,
  isOpenAITranslateSessionConfig,
  ResponseConfig,
} from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';
import { EphemeralTokenService } from '../EphemeralTokenService';
import { WebRTCAudioBridge, BufferedAudioMetadata } from '../../lib/modern-audio/WebRTCAudioBridge';
import { OpenAITranslateGAClient, computeRms } from './OpenAITranslateGAClient';

const TRANSLATE_CALLS_ENDPOINT_PATH = '/v1/realtime/translations/calls';
const SILENCE_TIMEOUT_MS = 1500;
const DEFAULT_API_HOST = 'https://api.openai.com';
const ICE_GATHERING_TIMEOUT_MS = 5000;
const DATA_CHANNEL_OPEN_TIMEOUT_MS = 10000;

interface WebRTCClientOptions {
  /** User's API key — exchanged for an ephemeral client_secret on connect */
  apiKey: string;
  /** Optional custom API host (defaults to https://api.openai.com) */
  apiHost?: string;
  /** Optional input device ID (microphone) */
  inputDeviceId?: string;
  /** Optional output device ID (speaker / sinkId) */
  outputDeviceId?: string;
}

interface ServerEvent {
  type: string;
  event_id?: string;
  [key: string]: any;
}

/**
 * OpenAI gpt-realtime-translate client using WebRTC transport.
 */
export class OpenAITranslateWebRTCClient implements IClient {
  private apiKey: string;
  private apiHost: string;
  private inputDeviceId?: string;
  private outputDeviceId?: string;

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioBridge: WebRTCAudioBridge;
  private eventHandlers: ClientEventHandlers = {};
  private connected: boolean = false;

  // Pairing state machine — mirrors OpenAITranslateGAClient verbatim.
  private currentPair: { userItemId: string; assistantItemId: string } | null = null;
  private deltaTimer: ReturnType<typeof setTimeout> | null = null;
  private audioChunks: Map<string, Int16Array[]> = new Map();
  private itemLookup: Map<string, ConversationItem> = new Map();
  private conversationItems: ConversationItem[] = [];
  private deltaSequenceNumber: number = 0;

  constructor(options: WebRTCClientOptions) {
    this.apiKey = options.apiKey;
    this.apiHost = (options.apiHost || DEFAULT_API_HOST).replace(/\/$/, '');
    this.inputDeviceId = options.inputDeviceId;
    this.outputDeviceId = options.outputDeviceId;

    // Match OpenAIWebRTCClient: 24 kHz PCM with 200 ms buffer for smooth
    // playback through ModernAudioPlayer's queue-based pipeline.
    this.audioBridge = new WebRTCAudioBridge({
      sampleRate: 24000,
      enablePCMBuffering: true,
      pcmBufferThresholdMs: 200,
      pcmFlushTimeoutMs: 100,
    });

    this.audioBridge.onBufferedAudioData = (pcmData: Int16Array, metadata: BufferedAudioMetadata) => {
      this.handleBufferedAudio(pcmData, metadata);
    };
  }

  // ----- Pairing state machine (copied verbatim from OpenAITranslateGAClient) -----

  private genItemId(): string {
    return `translate_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private resetDeltaTimer(): void {
    if (this.deltaTimer) clearTimeout(this.deltaTimer);
    this.deltaTimer = setTimeout(() => {
      this.completeCurrentPair();
    }, SILENCE_TIMEOUT_MS);
  }

  private ensurePair(): { userItemId: string; assistantItemId: string } {
    if (this.currentPair) return this.currentPair;

    const userItemId = this.genItemId();
    const assistantItemId = this.genItemId();
    this.currentPair = { userItemId, assistantItemId };

    const createdAt = Date.now();

    const userItem: ConversationItem = {
      id: userItemId,
      role: 'user',
      type: 'message',
      status: 'in_progress',
      createdAt,
      formatted: { text: '', transcript: '' },
      content: [],
    };
    const assistantItem: ConversationItem = {
      id: assistantItemId,
      role: 'assistant',
      type: 'message',
      status: 'in_progress',
      createdAt,
      formatted: { text: '', transcript: '' },
      content: [],
    };

    this.conversationItems.push(userItem, assistantItem);
    this.itemLookup.set(userItemId, userItem);
    this.itemLookup.set(assistantItemId, assistantItem);

    this.eventHandlers.onConversationUpdated?.({ item: userItem });
    this.eventHandlers.onConversationUpdated?.({ item: assistantItem });

    return this.currentPair;
  }

  private completeCurrentPair(): void {
    if (!this.currentPair) return;

    const { userItemId, assistantItemId } = this.currentPair;
    const userItem = this.itemLookup.get(userItemId);
    const assistantItem = this.itemLookup.get(assistantItemId);

    if (userItem) {
      userItem.status = 'completed';
      if (userItem.formatted) userItem.formatted.text = userItem.formatted.transcript || '';
      this.eventHandlers.onConversationUpdated?.({ item: userItem });
    }

    if (assistantItem) {
      assistantItem.status = 'completed';
      const chunks = this.audioChunks.get(assistantItemId);
      if (chunks && chunks.length > 0 && assistantItem.formatted) {
        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
        const merged = new Int16Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        assistantItem.formatted.audio = merged;
        this.audioChunks.delete(assistantItemId);
      }
      if (assistantItem.formatted) assistantItem.formatted.text = assistantItem.formatted.transcript || '';
      this.eventHandlers.onConversationUpdated?.({ item: assistantItem });
    }

    this.currentPair = null;
    if (this.deltaTimer) {
      clearTimeout(this.deltaTimer);
      this.deltaTimer = null;
    }
  }

  /**
   * Handle PCM frames produced by WebRTCAudioBridge from the remote audio
   * track. Attach the audio to the current pair's assistant item so it
   * shows up in the conversation alongside the transcript deltas.
   *
   * In WebRTC mode, the server emits no explicit session.output_audio.delta
   * events — audio is carried by the MediaStreamTrack — so we synthesize
   * the conversation update here using the same shape that the WebSocket
   * transport produces.
   */
  private handleBufferedAudio(pcmData: Int16Array, metadata: BufferedAudioMetadata): void {
    const pair = this.currentPair;
    if (!pair) {
      // Audio without preceding transcript is rare/unexpected for translate;
      // log and drop rather than synthesize a phantom pair.
      console.debug('[OpenAITranslateWebRTCClient] Received audio with no active pair; ignoring');
      return;
    }

    const assistantItem = this.itemLookup.get(pair.assistantItemId);
    if (!assistantItem) return;

    if (!this.audioChunks.has(pair.assistantItemId)) {
      this.audioChunks.set(pair.assistantItemId, []);
    }
    this.audioChunks.get(pair.assistantItemId)!.push(pcmData);

    this.eventHandlers.onConversationUpdated?.({
      item: assistantItem,
      delta: {
        audio: pcmData,
        sequenceNumber: metadata.sequenceNumber,
        timestamp: metadata.timestamp,
      },
    });
    this.resetDeltaTimer();
  }

  /**
   * Server event handler — same event types as OpenAITranslateGAClient.
   * Audio handling differs: WebRTC carries audio via MediaStreamTrack, so
   * session.output_audio.delta events are not expected here. We still
   * include them defensively in case the server emits them.
   */
  private handleServerEvent(event: ServerEvent): void {
    // Pre-decode + measure RMS for output audio so the log shows amplitude
    // and the case branch can reuse the decoded buffer.
    let decodedAudio: Int16Array | null = null;
    let audioRms: number | null = null;
    if (event.type === 'session.output_audio.delta' && (event as any).delta) {
      decodedAudio = base64ToInt16Array((event as any).delta);
      audioRms = computeRms(decodedAudio);
      (event as any).rms = audioRms;
    }

    // Skip log forwarding for pure-silence audio frames so heartbeats
    // don't dominate the timeline. Audio-handling switch below still runs.
    const isSilentAudioFrame =
      event.type === 'session.output_audio.delta' && audioRms === 0;
    if (!isSilentAudioFrame) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        // event.type is the loose `string` union from the server payload; the
        // log store's stricter literal union covers the same surface but TS
        // can't prove it. Cast to mirror the GA client / OpenAIWebRTCClient.
        event: { type: event.type as any, data: event },
      });
    }

    switch (event.type) {
      case 'session.input_transcript.delta': {
        const pair = this.ensurePair();
        const userItem = this.itemLookup.get(pair.userItemId);
        if (userItem?.formatted) {
          userItem.formatted.transcript = (userItem.formatted.transcript || '') + (event.delta || '');
        }
        this.eventHandlers.onConversationUpdated?.({
          item: userItem!,
          delta: { transcript: event.delta },
        });
        this.resetDeltaTimer();
        break;
      }

      case 'session.output_transcript.delta': {
        const pair = this.ensurePair();
        const assistantItem = this.itemLookup.get(pair.assistantItemId);
        if (assistantItem?.formatted) {
          assistantItem.formatted.transcript = (assistantItem.formatted.transcript || '') + (event.delta || '');
        }
        this.eventHandlers.onConversationUpdated?.({
          item: assistantItem!,
          delta: { transcript: event.delta },
        });
        this.resetDeltaTimer();
        break;
      }

      case 'session.output_audio.delta': {
        // Defensive: WebRTC carries audio through the MediaStreamTrack, so
        // this event is not expected here. Handle it anyway in case the
        // server emits it (matches GA client behavior).
        if (!event.delta || !decodedAudio) break;
        const audioData = decodedAudio;
        // Drop heartbeat / silent frames (rms === 0) so they don't pollute
        // playback or open phantom pairs. See GA client for rationale.
        if (audioRms === 0) break;

        const pair = this.ensurePair();
        const assistantItem = this.itemLookup.get(pair.assistantItemId);
        if (!assistantItem) break;

        const sequenceNumber = ++this.deltaSequenceNumber;

        if (!this.audioChunks.has(pair.assistantItemId)) {
          this.audioChunks.set(pair.assistantItemId, []);
        }
        this.audioChunks.get(pair.assistantItemId)!.push(audioData);

        this.eventHandlers.onConversationUpdated?.({
          item: assistantItem,
          delta: {
            audio: audioData,
            sequenceNumber,
            timestamp: Date.now(),
          },
        });
        this.resetDeltaTimer();
        break;
      }

      case 'session.input_transcript.done':
      case 'session.output_transcript.done':
      case 'session.output_audio.done':
        this.completeCurrentPair();
        break;

      case 'session.created':
      case 'session.updated':
        // No conversation impact; already forwarded via onRealtimeEvent above.
        break;

      case 'error': {
        const errorMessage = event.error?.message || event.error?.code || 'Unknown error';
        const errorItem: ConversationItem = {
          id: this.genItemId(),
          role: 'system',
          type: 'error',
          status: 'completed',
          formatted: { text: `[${event.error?.type || 'error'}] ${errorMessage}` },
          content: [{ type: 'text', text: errorMessage }],
        };
        this.eventHandlers.onConversationUpdated?.({ item: errorItem });
        this.eventHandlers.onError?.(event.error || event);
        break;
      }

      default:
        // Unhandled — already logged via onRealtimeEvent.
        break;
    }
  }

  // ----- IClient connect / disconnect -----

  async connect(config: SessionConfig): Promise<void> {
    if (!isOpenAITranslateSessionConfig(config)) {
      throw new Error('OpenAITranslateWebRTCClient requires translate session config');
    }

    // Reset state (matches GA client's connect).
    this.deltaSequenceNumber = 0;
    this.itemLookup.clear();
    this.conversationItems = [];
    this.audioChunks.clear();
    this.currentPair = null;

    try {
      // 1. Mint ephemeral client secret for the SDP exchange.
      const clientSecret = await EphemeralTokenService.mintTranslationClientSecret(
        this.apiKey,
        {
          targetLanguage: config.targetLanguage,
          transcriptModel: config.inputAudioTranscription?.model,
          noiseReductionType: config.inputAudioNoiseReduction?.type,
        },
        this.apiHost,
      );

      // 2. Create peer connection.
      this.pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      // 3. Attach local microphone tracks.
      const localStream = await this.audioBridge.getLocalStream(this.inputDeviceId);
      localStream.getTracks().forEach((track) => {
        this.pc!.addTrack(track, localStream);
      });

      // 4. Wire remote-track handler (translated audio).
      this.pc.ontrack = (event) => {
        console.debug('[OpenAITranslateWebRTCClient] Received remote track:', event.track.kind);
        if (event.streams && event.streams[0]) {
          this.audioBridge.handleRemoteStream(event.streams[0], this.outputDeviceId);
        }
      };

      // 5. Connection state hooks.
      this.pc.oniceconnectionstatechange = () => {
        const state = this.pc?.iceConnectionState;
        console.debug('[OpenAITranslateWebRTCClient] ICE connection state:', state);
        if (state === 'disconnected' || state === 'failed') {
          this.handleDisconnection();
        }
      };

      this.pc.onconnectionstatechange = () => {
        const state = this.pc?.connectionState;
        console.debug('[OpenAITranslateWebRTCClient] Connection state:', state);
        if (state === 'connected') {
          this.connected = true;
          this.eventHandlers.onOpen?.();
        } else if (state === 'failed' || state === 'closed') {
          this.handleDisconnection();
        }
      };

      // 6. Open data channel for events.
      this.dc = this.pc.createDataChannel('oai-events');
      this.setupDataChannelListeners();

      // 7. Create offer + wait for ICE gathering.
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await this.waitForIceGathering();

      // 8. SDP exchange against translate calls endpoint.
      const answerSdp = await this.sendOfferToOpenAI(
        this.pc.localDescription!.sdp,
        clientSecret,
      );
      await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      // 9. Wait for data channel and send session.update over it.
      await this.waitForDataChannelOpen();
      const updatePayload = OpenAITranslateGAClient.buildSessionUpdate(config);
      this.dc!.send(JSON.stringify(updatePayload));
      this.eventHandlers.onRealtimeEvent?.({
        source: 'client',
        event: { type: 'session.update', data: updatePayload },
      });

      // 10. Mark connected and emit session.opened for log parity with GA.
      this.connected = true;
      this.eventHandlers.onRealtimeEvent?.({
        source: 'client',
        event: {
          type: 'session.opened',
          data: {
            status: 'connected',
            provider: 'openai_translate',
            model: config.model,
            timestamp: Date.now(),
          },
        },
      });
      this.eventHandlers.onOpen?.();

      console.info('[OpenAITranslateWebRTCClient] WebRTC connection established');
    } catch (error) {
      console.error('[OpenAITranslateWebRTCClient] Connection failed:', error);
      this.cleanup();
      throw error;
    }
  }

  /**
   * Wait for ICE gathering to complete (or until timeout).
   */
  private waitForIceGathering(): Promise<void> {
    return new Promise((resolve) => {
      if (this.pc?.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const checkState = () => {
        if (this.pc?.iceGatheringState === 'complete') {
          this.pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };

      this.pc?.addEventListener('icegatheringstatechange', checkState);

      setTimeout(() => {
        this.pc?.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }, ICE_GATHERING_TIMEOUT_MS);
    });
  }

  /**
   * Wait for the data channel to open (rejects on timeout / error).
   */
  private waitForDataChannelOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.dc?.readyState === 'open') {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Data channel open timeout'));
      }, DATA_CHANNEL_OPEN_TIMEOUT_MS);

      this.dc!.onopen = () => {
        clearTimeout(timeout);
        console.debug('[OpenAITranslateWebRTCClient] Data channel opened');
        resolve();
      };

      this.dc!.onerror = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
    });
  }

  /**
   * POST the local SDP offer to translate's calls endpoint and return the
   * answer SDP. Authenticates with the ephemeral client_secret.
   */
  private async sendOfferToOpenAI(sdp: string, clientSecret: string): Promise<string> {
    const endpoint = `${this.apiHost}${TRANSLATE_CALLS_ENDPOINT_PATH}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        'Content-Type': 'application/sdp',
      },
      body: sdp,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to establish WebRTC connection: ${response.status} ${errorText}`);
    }

    return await response.text();
  }

  /**
   * Set up message / error / close handlers on the data channel.
   */
  private setupDataChannelListeners(): void {
    if (!this.dc) return;

    this.dc.onmessage = (event) => {
      try {
        const serverEvent: ServerEvent = JSON.parse(event.data);
        this.handleServerEvent(serverEvent);
      } catch (error) {
        console.error('[OpenAITranslateWebRTCClient] Failed to parse server event:', error);
      }
    };

    this.dc.onerror = (error) => {
      console.error('[OpenAITranslateWebRTCClient] Data channel error:', error);
      this.eventHandlers.onError?.(error);
    };

    this.dc.onclose = () => {
      console.debug('[OpenAITranslateWebRTCClient] Data channel closed');
      this.handleDisconnection();
    };
  }

  /**
   * Handle disconnection — fires once, runs full cleanup, notifies handler.
   */
  private handleDisconnection(): void {
    if (!this.connected) return;

    this.connected = false;
    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'session.closed',
        data: {
          status: 'disconnected',
          provider: 'openai_translate',
          timestamp: Date.now(),
          reason: 'webrtc_closed',
        },
      },
    });
    this.eventHandlers.onClose?.({ reason: 'disconnected' });
    this.cleanup();
  }

  /**
   * Tear down peer connection, data channel, and audio bridge.
   */
  private cleanup(): void {
    if (this.deltaTimer) {
      clearTimeout(this.deltaTimer);
      this.deltaTimer = null;
    }

    this.audioBridge.cleanup();

    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    this.connected = false;
  }

  async disconnect(): Promise<void> {
    console.info('[OpenAITranslateWebRTCClient] Disconnecting...');
    // Finalize any in-flight pair so partial transcripts surface as completed.
    this.completeCurrentPair();
    this.cleanup();
  }

  isConnected(): boolean {
    return this.connected && this.dc?.readyState === 'open';
  }

  updateSession(config: Partial<SessionConfig>): void {
    if (!this.dc || this.dc.readyState !== 'open') return;
    if (!isOpenAITranslateSessionConfig(config as SessionConfig)) return;
    const updatePayload = OpenAITranslateGAClient.buildSessionUpdate(config as OpenAITranslateSessionConfig);
    this.dc.send(JSON.stringify(updatePayload));
    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: { type: 'session.update', data: updatePayload },
    });
  }

  reset(): void {
    if (this.deltaTimer) {
      clearTimeout(this.deltaTimer);
      this.deltaTimer = null;
    }
    this.currentPair = null;
    this.conversationItems = [];
    this.itemLookup.clear();
    this.audioChunks.clear();
    this.deltaSequenceNumber = 0;
  }

  /**
   * No-op — in WebRTC mode, audio flows via the MediaStreamTrack. The
   * method exists for IClient compatibility.
   */
  appendInputAudio(_audioData: Int16Array): void {
    // Intentionally empty.
  }

  /** No-op — translate doesn't accept text input. */
  appendInputText(_text: string): void { /* no-op */ }

  /** No-op — translate has no response lifecycle (continuous streaming). */
  createResponse(_config?: ResponseConfig): void { /* no-op */ }

  /** No-op for Phase 1 — matches GA client behavior. */
  cancelResponse(_trackId?: string, _offset?: number): void { /* no-op */ }

  getConversationItems(): ConversationItem[] {
    return [...this.conversationItems];
  }

  clearConversationItems(): void {
    this.conversationItems = [];
    this.itemLookup.clear();
    this.audioChunks.clear();
  }

  setEventHandlers(handlers: ClientEventHandlers): void {
    this.eventHandlers = { ...handlers };
  }

  getProvider(): ProviderType {
    return Provider.OPENAI_TRANSLATE;
  }

  getAudioBridge(): WebRTCAudioBridge {
    return this.audioBridge;
  }

  async switchInputDevice(deviceId: string): Promise<void> {
    if (!this.pc) return;

    this.inputDeviceId = deviceId;
    const newStream = await this.audioBridge.getLocalStream(deviceId);

    const senders = this.pc.getSenders();
    const audioSender = senders.find((s) => s.track?.kind === 'audio');

    if (audioSender) {
      const newTrack = newStream.getAudioTracks()[0];
      await audioSender.replaceTrack(newTrack);
      console.debug('[OpenAITranslateWebRTCClient] Switched input device to:', deviceId);
    }
  }

  async switchOutputDevice(deviceId: string): Promise<void> {
    this.outputDeviceId = deviceId;
    await this.audioBridge.setOutputDevice(deviceId);
    console.debug('[OpenAITranslateWebRTCClient] Switched output device to:', deviceId);
  }

  setVolume(volume: number): void {
    this.audioBridge.setVolume(volume);
  }

  /**
   * Mute control is delegated to ModernAudioPlayer / audioStore in the same
   * way OpenAIWebRTCClient does it — the WebRTC HTMLAudioElement stays
   * muted to prevent double playback.
   */
  setOutputMuted(muted: boolean): void {
    console.debug('[OpenAITranslateWebRTCClient] Output muted request (no-op, handled by audioStore):', muted);
  }

  getFrequencies(): { values: Float32Array } | null {
    return this.audioBridge.getFrequencies();
  }
}

// Helper: decode base64 PCM16 into an Int16Array. Mirrors the file-scoped
// helper in OpenAITranslateGAClient — duplicated rather than exported per
// spec ("ABSORB the duplication for now").
function base64ToInt16Array(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}
