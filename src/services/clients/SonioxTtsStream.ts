/**
 * Soniox real-time TTS WebSocket wire component.
 *
 * Protocol-only: knows the Soniox TTS wire protocol and nothing about STT,
 * IClient or Sokuji semantics. Deliberately decoupled — it consumes a
 * (text, language) event stream from ANY source, which is the seam for
 * future cross-provider composition (e.g. another STT → Soniox TTS).
 *
 * Stream model (mirrors the official soniox_examples STS demo):
 * - One TTS stream per utterance over a single WebSocket, identified by
 *   stream_id. A stream is opened lazily by the first text of an utterance
 *   (config message), fed {text, text_end:false} chunks, and closed with
 *   {text:"", text_end:true}.
 * - Streams that produced audio are serialized: we wait for the server's
 *   {terminated} of the previous stream before opening the next, so audio
 *   chunks never interleave between utterances. Text arriving meanwhile is
 *   queued.
 * - prewarm() pre-opens a stream so the first utterance skips the config
 *   round-trip (~400 ms). A prewarmed stream with the wrong language (only
 *   possible in two_way mode) is discarded immediately — it produced no
 *   audio, so no serialization wait is needed.
 * - {keep_alive:true} every 20 s (NOTE: different shape from the STT
 *   keepalive {"type":"keepalive"}). Does NOT prevent the server from closing
 *   a socket with no active stream — measured live at ~5.3 s with a 408
 *   ("Request timeout") error, well inside this 20 s interval — so
 *   SonioxClient's reconnect-on-demand (ensureTts) is what actually keeps
 *   speech flowing across a silence, not this. Every onError report carries
 *   `hadActiveStream` so the caller can tell this ordinary idle drop (no
 *   stream was carrying content) apart from one that hit real speech.
 */
import { SONIOX_REDUCE_SILENCE } from '../../lib/soniox/ttsCatalog';

export interface SonioxTtsOptions {
  apiKey: string;
  voice: string;
  model: string;
  sampleRate: number;
  /** Speaking rate 0.7..1.3; undefined or 1.0 (the server default) is omitted from the wire. */
  speed?: number;
  // Managed-mode only: must match the STT stream's clientReferenceId, or the
  // TTS half of the session cannot be attributed to the billing lease.
  clientReferenceId?: string;
}

export interface SonioxTtsStreamHandlers {
  onAudio?: (audio: Int16Array) => void;
  // hadActiveStream: whether a stream carrying real utterance content (active
  // or still draining its final audio) existed at the moment of this
  // error/close, as opposed to a socket that was genuinely idle (no stream
  // ever opened, or already fully drained) — e.g. the ~5.3 s "no active
  // stream" 408 idle-timeout. The caller (SonioxClient.handleTtsError) uses
  // this, not the wire code, to decide whether a drop is expected (silently
  // recovered by ensureTts) or a genuine loss of spoken output.
  onError?: (code: string, message: string, hadActiveStream: boolean) => void;
}

interface QueuedItem {
  kind: 'text' | 'end';
  text?: string;
  language?: string;
}

const TTS_URL = 'wss://tts-rt.soniox.com/tts-websocket';
const CONNECTION_TIMEOUT_MS = 15000;
const KEEPALIVE_INTERVAL_MS = 20000;

export class SonioxTtsStream {
  private options: SonioxTtsOptions;
  private ws: WebSocket | null = null;
  private handlers: SonioxTtsStreamHandlers = {};
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  // Active stream state
  private activeStreamId: string | null = null;
  private activeLanguage: string | null = null;
  private activeStreamUsed = false;     // has the active stream received any text?
  private drainingStreamId: string | null = null; // used stream closed, terminated pending
  private queue: QueuedItem[] = [];
  private utteranceCounter = 0;
  private prewarmCounter = 0;
  private intentionalClose = false;

  constructor(options: SonioxTtsOptions) {
    this.options = options;
  }

  setHandlers(handlers: SonioxTtsStreamHandlers): void {
    this.handlers = handlers;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(TTS_URL);
      this.ws = ws;
      this.intentionalClose = false;
      let opened = false;
      const timer = setTimeout(() => {
        if (!opened) {
          // Reject with the timeout reason BEFORE closing: ws.close() triggers
          // onclose, whose pre-open branch would otherwise settle the promise
          // first and mask the timeout reason.
          reject(new Error('Soniox TTS connection timeout'));
          ws.close();
        }
      }, CONNECTION_TIMEOUT_MS);

      ws.onopen = () => {
        opened = true;
        clearTimeout(timer);
        this.startKeepalive();
        resolve();
      };

      ws.onmessage = (event) => {
        let data: { stream_id?: string; audio?: string; terminated?: boolean; error_code?: number | string; error_message?: string };
        try {
          data = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (data.error_code != null) {
          // Snapshot BEFORE handleStreamFailure clears it — this is the seam
          // the caller uses to tell an idle-timeout drop from a genuine one.
          const hadActiveStream = (this.activeStreamId !== null && this.activeStreamUsed) || this.drainingStreamId !== null;
          this.handlers.onError?.(String(data.error_code), data.error_message ?? '', hadActiveStream);
          this.handleStreamFailure(data.stream_id);
        } else if (data.audio && (data.stream_id === this.activeStreamId || data.stream_id === this.drainingStreamId)) {
          this.handlers.onAudio?.(this.base64ToInt16(data.audio));
        }
        // terminated must always be processed, even when the same message also
        // carried an error — otherwise a combined error+terminated frame would
        // leave drainingStreamId set and wedge the queue forever.
        if (data.terminated) {
          if (data.stream_id === this.drainingStreamId) {
            this.drainingStreamId = null;
            this.flushQueue();
          }
        }
      };

      ws.onerror = (error) => {
        clearTimeout(timer);
        if (!opened) {
          reject(error instanceof Error ? error : new Error('Soniox TTS connection failed'));
        } else {
          const hadActiveStream = (this.activeStreamId !== null && this.activeStreamUsed) || this.drainingStreamId !== null;
          this.handlers.onError?.('socket_error', String(error), hadActiveStream);
        }
      };

      ws.onclose = () => {
        clearTimeout(timer);
        this.stopKeepalive();
        if (!opened) {
          // Closed before it ever opened → settle connect() now rather than
          // hang until the connection timeout fires. Covers intentional
          // cancellation too (a close() during connect).
          reject(new Error('Soniox TTS socket closed before opening'));
          return;
        }
        if (!this.intentionalClose) {
          // Snapshot BEFORE clearing — same seam as the error branch above.
          const hadActiveStream = (this.activeStreamId !== null && this.activeStreamUsed) || this.drainingStreamId !== null;
          this.activeStreamId = null;
          this.activeLanguage = null;
          this.activeStreamUsed = false;
          this.drainingStreamId = null;
          this.queue = [];
          this.handlers.onError?.('socket_closed', 'Soniox TTS socket closed unexpectedly', hadActiveStream);
        }
      };
    });
  }

  /** Pre-open a stream so the first utterance skips the config round-trip. */
  prewarm(language: string): void {
    if (!this.isOpen() || this.activeStreamId || this.drainingStreamId) return;
    this.prewarmCounter += 1;
    const streamId = `prewarm-${this.prewarmCounter}`;
    this.openStream(streamId, language);
  }

  sendText(text: string, language: string): void {
    if (!this.isOpen()) return;
    if (this.drainingStreamId) {
      this.queue.push({ kind: 'text', text, language });
      return;
    }
    this.doSendText(text, language);
  }

  endUtterance(): void {
    if (!this.isOpen()) return;
    if (this.drainingStreamId) {
      this.queue.push({ kind: 'end' });
      return;
    }
    this.doEndUtterance();
  }

  close(): void {
    this.intentionalClose = true;
    this.stopKeepalive();
    this.queue = [];
    if (this.ws) {
      // Best-effort close of the active stream so the server frees it.
      if (this.activeStreamId && this.activeStreamUsed) {
        try {
          this.ws.send(JSON.stringify({ stream_id: this.activeStreamId, text: '', text_end: true }));
        } catch { /* closing anyway */ }
      }
      this.ws.close();
      this.ws = null;
    }
    this.activeStreamId = null;
    this.activeLanguage = null;
    this.activeStreamUsed = false;
    this.drainingStreamId = null;
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private doSendText(text: string, language: string): void {
    // Unused stream (prewarm) with wrong language: discard immediately.
    // It produced no audio, so there is nothing to serialize against.
    if (this.activeStreamId && !this.activeStreamUsed && this.activeLanguage !== language) {
      this.ws!.send(JSON.stringify({ stream_id: this.activeStreamId, text: '', text_end: true }));
      this.activeStreamId = null;
      this.activeLanguage = null;
    }
    if (!this.activeStreamId) {
      this.utteranceCounter += 1;
      this.openStream(`utt-${this.utteranceCounter}`, language);
    }
    this.ws!.send(JSON.stringify({ stream_id: this.activeStreamId, text, text_end: false }));
    this.activeStreamUsed = true;
  }

  private doEndUtterance(): void {
    if (!this.activeStreamId || !this.activeStreamUsed) return;
    this.ws!.send(JSON.stringify({ stream_id: this.activeStreamId, text: '', text_end: true }));
    // The stream produced audio: serialize the next one behind its terminated.
    this.drainingStreamId = this.activeStreamId;
    this.activeStreamId = null;
    this.activeLanguage = null;
    this.activeStreamUsed = false;
  }

  /**
   * Reset stream state after a wire error so a wedged component never results:
   * the failing stream (whichever role it held) is forgotten, and anything
   * queued behind a draining stream is released.
   */
  private handleStreamFailure(streamId?: string): void {
    if (streamId === undefined) {
      // Connection-level error: no specific stream named, clear everything.
      this.activeStreamId = null;
      this.activeLanguage = null;
      this.activeStreamUsed = false;
      this.drainingStreamId = null;
      this.flushQueue();
      return;
    }
    if (streamId === this.activeStreamId) {
      this.activeStreamId = null;
      this.activeLanguage = null;
      this.activeStreamUsed = false;
    }
    if (streamId === this.drainingStreamId) {
      this.drainingStreamId = null;
      this.flushQueue();
    }
  }

  private flushQueue(): void {
    while (this.queue.length > 0 && !this.drainingStreamId) {
      const item = this.queue.shift()!;
      if (item.kind === 'text') {
        this.doSendText(item.text!, item.language!);
      } else {
        this.doEndUtterance();
      }
    }
  }

  private openStream(streamId: string, language: string): void {
    this.ws!.send(JSON.stringify({
      api_key: this.options.apiKey,
      stream_id: streamId,
      model: this.options.model,
      voice: this.options.voice,
      language,
      audio_format: 'pcm_s16le',
      sample_rate: this.options.sampleRate,
      // Sent unconditionally: it is only valid on models that advertise
      // supports_silence_reduction, and this stream only ever opens against
      // one (SONIOX_TTS_MODEL). A model that does not support it answers 400,
      // which is the loud failure we want if that constant ever moves back.
      reduce_silence: SONIOX_REDUCE_SILENCE,
      ...(this.options.speed != null && this.options.speed !== 1.0 ? { speed: this.options.speed } : {}),
      ...(this.options.clientReferenceId ? { client_reference_id: this.options.clientReferenceId } : {}),
    }));
    this.activeStreamId = streamId;
    this.activeLanguage = language;
    this.activeStreamUsed = false;
  }

  private base64ToInt16(b64: string): Int16Array {
    const bin = atob(b64);
    const evenLength = bin.length - (bin.length % 2);
    const bytes = new Uint8Array(evenLength);
    for (let i = 0; i < evenLength; i++) bytes[i] = bin.charCodeAt(i);
    return new Int16Array(bytes.buffer);
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.isOpen()) {
        this.ws!.send(JSON.stringify({ keep_alive: true }));
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }
}
