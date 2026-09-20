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
import type { ClientDiagnosticCode } from '../../lib/diagnostics/clientDiagnostics';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { SentenceStream } from '../../lib/segmentation/SentenceStream';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';
import { clampSegmentPauseMs, DEFAULT_SEGMENT_PAUSE_MS } from '../../lib/segmentation/segmentationMode';

const TRANSLATE_CALLS_ENDPOINT_PATH = '/v1/realtime/translations/calls';
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
  /** The sentence segmentation stage, or null/absent for today's behaviour. */
  segmentation?: SegmentationRuntime | null;
  /** How many sentences fill a bubble once the stage is on. */
  sentencesPerChunk?: number;
  /**
   * The translation half of the global pause pair, in milliseconds. This
   * client takes only that half — see `pairSilenceMs` — and deliberately does
   * not accept the source one: there is no timer here for it to drive, and an
   * option that is quietly ignored is worse than one that is absent.
   */
  translationPauseMs?: number;
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

  /**
   * Latches once a frame has failed to parse, so a server sending garbage
   * reports once rather than once per frame. Cleared by the next frame that
   * parses. The panel throttles as well, but the console line fires on every
   * call by design — this is what bounds it.
   */
  private parseFailed: boolean = false;

  /**
   * Emit a diagnostic: the session continues, degraded. participantTelemetry
   * gives the code its channel and severity.
   */
  private diagnose(code: ClientDiagnosticCode, message: string, cause?: unknown): void {
    this.eventHandlers.onDiagnostic?.({ code, message, cause });
  }

  private connected: boolean = false;

  // Pairing state machine — mirrors OpenAITranslateGAClient verbatim.
  //
  // A side's id is null only while the stage's seal has closed that item and
  // the pair is waiting for the remainder — or the next delta — to open its
  // replacement. Without the stage, both ids stay set for the pair's whole
  // life, exactly as before.
  private currentPair: { userItemId: string | null; assistantItemId: string | null } | null = null;
  private deltaTimer: ReturnType<typeof setTimeout> | null = null;
  private audioChunks: Map<string, Int16Array[]> = new Map();
  private itemLookup: Map<string, ConversationItem> = new Map();
  private conversationItems: ConversationItem[] = [];
  private deltaSequenceNumber: number = 0;

  /**
   * Cached from `config.keepReplayAudio` at connect(). When false, the
   * single `formatted.audio = merged` assignment is skipped — the inline
   * replay button stays hidden and no per-item PCM memory is retained.
   * Real-time WebRTC audio playback (handled by the browser's audio
   * element) is unaffected.
   */
  private keepReplayAudio: boolean = false;

  // ----- Sentence segmentation stage -----
  //
  // Both fields come from ClientOptions and are never re-read from a store, so
  // a running session cannot react to either setting changing. A null or
  // disabled runtime means today's behaviour, byte for byte.
  private segmentation: SegmentationRuntime | null = null;
  private sentencesPerChunk = 3;
  /**
   * R2: the session's one answer, frozen in connect() and cleared in
   * disconnect(). `runtime.enabled` moves in BOTH directions under an open
   * session and `SentenceStream` reads it once at its own construction, so a
   * stream built from a flipped value goes inert while this client still
   * routes text into it. See OpenAITranslateGAClient's field doc.
   */
  private sessionSegmentation: SegmentationRuntime | null = null;
  /**
   * The source side of the pair only.
   *
   * There is deliberately no translation-side stream. `handleBufferedAudio`
   * attaches every remote frame to whichever assistant item is open when it
   * arrives, and this API reports no per-item timeline — the deltas carry no
   * timing at all — so a split translation item cannot be told where its own
   * audio ends. The frames belonging to a sealed sentence would land on the
   * next bubble and put every later karaoke highlight one bubble out. GPT-Live
   * segments both sides because it has that timeline:
   * `OpenAILiveClient.closeAssistantText` queues the closed item on
   * `pendingAudioItems` with its `end_ms` and keeps feeding it frames until the
   * session clock passes it. Nothing here can be rebuilt from without guessing.
   */
  private userStream: SentenceStream | null = null;
  /**
   * The one timer this transport has: it closes the source item and the
   * translation item together, and both sides re-arm it.
   *
   * It takes the TRANSLATION pause of the global pair, not the source one. The
   * last delta of a pair is the translation's — the speaker stopped before the
   * translation caught up — so the gap this timer ends up measuring is
   * translation-side silence. There is no second timer to give the source
   * pause to: unlike the WebSocket client, this one has no translation-side
   * stream and cannot close the two sides at different moments (see
   * `userStream` above for why).
   */
  private pairSilenceMs = DEFAULT_SEGMENT_PAUSE_MS;
  /** The raw text the stream still holds, mirrored from its onPending. */
  private userPending = '';
  /** Set while a seal from the stream is closing an item, so the close does not
   *  turn around and end() the stream that produced it. */
  private sealingUser = false;
  /** The language the stream punctuates in, read once at connect(). */
  private sourceLanguage = 'auto';

  constructor(options: WebRTCClientOptions) {
    this.apiKey = options.apiKey;
    this.apiHost = (options.apiHost || DEFAULT_API_HOST).replace(/\/$/, '');
    this.inputDeviceId = options.inputDeviceId;
    this.outputDeviceId = options.outputDeviceId;
    this.segmentation = options.segmentation ?? null;
    this.sentencesPerChunk = options.sentencesPerChunk ?? 3;
    this.pairSilenceMs = clampSegmentPauseMs(options.translationPauseMs);

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
    }, this.pairSilenceMs);
  }

  /** Create, register and announce one side's item, and return its id. */
  private openItem(role: 'user' | 'assistant'): string {
    const id = this.genItemId();
    const item: ConversationItem = {
      id,
      role,
      type: 'message',
      status: 'in_progress',
      createdAt: Date.now(),
      formatted: { text: '', transcript: '' },
      content: [],
    };
    this.conversationItems.push(item);
    this.itemLookup.set(id, item);
    this.eventHandlers.onConversationUpdated?.({ item });
    return id;
  }

  private ensurePair(): { userItemId: string | null; assistantItemId: string | null } {
    if (this.currentPair) return this.currentPair;
    // Both sides are opened together so the UI gets the pair, even when only
    // one of them will carry text.
    this.currentPair = { userItemId: this.openItem('user'), assistantItemId: this.openItem('assistant') };
    return this.currentPair;
  }

  /** The open pair's source item, opening a replacement inside the same pair
   *  when the stage's seal closed the previous one. */
  private ensureUserItemId(): string {
    const pair = this.ensurePair();
    if (!pair.userItemId) pair.userItemId = this.openItem('user');
    return pair.userItemId;
  }

  /** The translation twin of ensureUserItemId. Nothing but the pair timer ever
   *  closes this item mid-stream, which is what keeps its audio attached to it
   *  — see the `userStream` field doc. */
  private ensureAssistantItemId(): string {
    const pair = this.ensurePair();
    if (!pair.assistantItemId) pair.assistantItemId = this.openItem('assistant');
    return pair.assistantItemId;
  }

  /** Close just the source item; the pair stays open so the translation keeps
   *  streaming into the item it already has. */
  private closeUserItem(): void {
    // Every path that ends a source item comes through here, so this is where
    // the stage's stream is wound up; the seal it emits closes the item on its
    // own and the code below then finds nothing left to do.
    this.endUserStream();
    const pair = this.currentPair;
    if (!pair?.userItemId) return;
    const userItem = this.itemLookup.get(pair.userItemId);
    if (userItem) {
      userItem.status = 'completed';
      if (userItem.formatted) userItem.formatted.text = userItem.formatted.transcript || '';
      this.eventHandlers.onConversationUpdated?.({ item: userItem });
    }
    pair.userItemId = null;
  }

  /** Close just the translation item, handing over its buffered audio. */
  private closeAssistantItem(): void {
    // No stream to wind up: the stage does not run on this side. See the
    // `userStream` field doc for why.
    const pair = this.currentPair;
    if (!pair?.assistantItemId) return;
    const assistantItemId = pair.assistantItemId;
    const assistantItem = this.itemLookup.get(assistantItemId);
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
        if (this.keepReplayAudio) {
          assistantItem.formatted.audio = merged;
        }
        this.audioChunks.delete(assistantItemId);
      }
      if (assistantItem.formatted) assistantItem.formatted.text = assistantItem.formatted.transcript || '';
      this.eventHandlers.onConversationUpdated?.({ item: assistantItem });
    }
    pair.assistantItemId = null;
  }

  private completeCurrentPair(): void {
    // Both sides, then the pair itself. Each half ends its stage stream first,
    // so a tail still held there lands in the item it belongs to.
    this.closeUserItem();
    this.closeAssistantItem();
    if (!this.currentPair) return;

    this.currentPair = null;
    if (this.deltaTimer) {
      clearTimeout(this.deltaTimer);
      this.deltaTimer = null;
    }
  }

  // ----- Segmentation stage -----

  /** The stream feeding the open source item, or null when the stage is off
   *  for this session. */
  private ensureUserStream(): SentenceStream | null {
    if (this.userStream) return this.userStream;
    if (!this.sessionSegmentation) return null;
    this.userStream = new SentenceStream({
      lang: this.sourceLanguage,
      // The frozen view, never `this.segmentation` (R2).
      runtime: this.sessionSegmentation,
      sentencesPerChunk: this.sentencesPerChunk,
      onSeal: (chunk) => this.sealUserItem(chunk.text),
      onPending: (text) => this.onUserPending(text),
    });
    return this.userStream;
  }

  /** The unsealed tail. After a seal this is the remainder and the item it
   *  belongs to has just closed, so it opens the next one; after an ordinary
   *  update the open item already holds exactly this text. */
  private onUserPending(text: string): void {
    this.userPending = text;
    if (text.length === 0) return;
    const item = this.itemLookup.get(this.ensureUserItemId());
    // A cut lands just past a sentence end, so a remainder can start with the
    // space that followed it.
    const shown = text.replace(/^\s+/, '');
    if (item?.formatted && item.formatted.transcript !== shown) {
      item.formatted.transcript = shown;
      this.eventHandlers.onConversationUpdated?.({ item });
    }
    // No timer to re-arm: the pair's single deltaTimer outlives a one-sided
    // close, and only completeCurrentPair clears it.
  }

  /** The stage decided this item ends here. The sealed text carries the marks
   *  the model inserted, so the item is rewritten rather than merely closed. */
  private sealUserItem(sealed: string): void {
    const id = this.currentPair?.userItemId;
    if (!id) return;
    const item = this.itemLookup.get(id);
    if (item?.formatted) {
      item.formatted.transcript = sealed.replace(/^\s+/, '');
      this.eventHandlers.onConversationUpdated?.({ item });
    }
    this.sealingUser = true;
    try {
      this.closeUserItem();
    } finally {
      this.sealingUser = false;
    }
  }

  /** Seal whatever the stream still holds into the item it was feeding, then
   *  drop it. Re-entrant by design: the seal closes that item through
   *  closeUserItem, which lands back here with the stream already gone. */
  private endUserStream(): void {
    // A seal is mid-flight and owns the remainder; it is opening the next item
    // with it as this returns.
    if (this.sealingUser) return;
    const stream = this.userStream;
    if (stream) {
      this.userStream = null;
      stream.end();
      stream.dispose();
    }
    this.userPending = '';
  }

  /** Drop the stream without its final seal — the items it was feeding are
   *  being forgotten too. */
  private discardUserStream(): void {
    this.userStream?.dispose();
    this.userStream = null;
    this.userPending = '';
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
    if (!this.currentPair) {
      // Audio without preceding transcript is rare/unexpected for translate;
      // log and drop rather than synthesize a phantom pair.
      console.debug('[OpenAITranslateWebRTCClient] Received audio with no active pair; ignoring');
      return;
    }
    const assistantItemId = this.ensureAssistantItemId();

    const assistantItem = this.itemLookup.get(assistantItemId);
    if (!assistantItem) return;

    if (this.keepReplayAudio) {
      if (!this.audioChunks.has(assistantItemId)) {
        this.audioChunks.set(assistantItemId, []);
      }
      this.audioChunks.get(assistantItemId)!.push(pcmData);
    }

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
        const userItem = this.itemLookup.get(this.ensureUserItemId());
        if (userItem?.formatted) {
          userItem.formatted.transcript = (userItem.formatted.transcript || '') + (event.delta || '');
        }
        this.eventHandlers.onConversationUpdated?.({
          item: userItem!,
          delta: { transcript: event.delta },
        });
        // The stage sees the whole unsealed tail, which is what the item now
        // holds. A seal inside this call closes the item and opens the next.
        if (event.delta) this.ensureUserStream()?.update(this.userPending + event.delta);
        this.resetDeltaTimer();
        break;
      }

      case 'session.output_transcript.delta': {
        const assistantItem = this.itemLookup.get(this.ensureAssistantItemId());
        if (assistantItem?.formatted) {
          assistantItem.formatted.transcript = (assistantItem.formatted.transcript || '') + (event.delta || '');
        }
        this.eventHandlers.onConversationUpdated?.({
          item: assistantItem!,
          delta: { transcript: event.delta },
        });
        // No stage on this side: see the `userStream` field doc.
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

        const assistantItemId = this.ensureAssistantItemId();
        const assistantItem = this.itemLookup.get(assistantItemId);
        if (!assistantItem) break;

        const sequenceNumber = ++this.deltaSequenceNumber;

        if (this.keepReplayAudio) {
          if (!this.audioChunks.has(assistantItemId)) {
            this.audioChunks.set(assistantItemId, []);
          }
          this.audioChunks.get(assistantItemId)!.push(audioData);
        }

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
    this.keepReplayAudio = config.keepReplayAudio ?? false;
    this.discardUserStream();
    this.sourceLanguage = config.sourceLanguage ?? 'auto';
    // R2: the one read of `enabled` this session gets. Everything downstream —
    // the stream and every rebuild of it — sees this frozen view, never the
    // live runtime. See the `sessionSegmentation` field doc.
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
      // Rethrown into MainPanel's session-start catch, which owns the report.
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
        this.parseFailed = false;
        this.handleServerEvent(serverEvent);
      } catch (error) {
        if (!this.parseFailed) {
          this.parseFailed = true;
          this.diagnose('parse_error', `server event could not be parsed: ${describeCause(error)}`, error);
        }
      }
    };

    this.dc.onerror = (error) => {
      // Normalised for the same reason as OpenAIWebRTCClient: a raw
      // RTCErrorEvent reads as 'Unknown error' downstream.
      this.eventHandlers.onError?.({
        code: 'data_channel_error',
        message: `Data channel error: ${describeCause((error as RTCErrorEvent).error ?? error)}`,
      });
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
    // Both halves seal their stream's tail into their item on the way out, so
    // this has to run before the session's frozen answer is dropped.
    this.completeCurrentPair();
    this.sessionSegmentation = null;
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
    // Dropped rather than ended: the items this stream was feeding are being
    // forgotten too.
    this.discardUserStream();
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

  /** REMOTE/received audio (the AI's translated output). No current consumer; kept as-is. */
  getFrequencies(): { values: Float32Array } | null {
    return this.audioBridge.getFrequencies();
  }

  /**
   * Get LOCAL (microphone) frequency data for visualization — the input-side
   * counterpart to getFrequencies() above. Backs MainPanel's mic-waveform
   * fallback for native-capture sessions, which never start the shared
   * recorder.
   */
  getInputFrequencies(): { values: Float32Array } | null {
    return this.audioBridge.getLocalFrequencies();
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
