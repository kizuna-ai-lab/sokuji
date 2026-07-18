/**
 * Soniox real-time STT+translation WebSocket wire component.
 *
 * Protocol-only: this class knows the Soniox STT wire protocol and nothing
 * about IClient or Sokuji conversation semantics (that is SonioxClient's job).
 *
 * Live-verified protocol facts (2026-07-18):
 * - The first frame after open MUST be a JSON config message.
 * - Raw headerless PCM requires explicit audio_format/sample_rate/num_channels;
 *   "auto" only sniffs containers and 408s on raw PCM.
 * - End-of-stream is an EMPTY TEXT frame (""): the server flushes remaining
 *   tokens, replies {finished:true} and closes the connection.
 * - {"type":"finalize"} only finalizes pending tokens (emits a <fin> token);
 *   it does NOT end the session.
 * - ~20 s without input triggers "408 Request timeout"; {"type":"keepalive"}
 *   prevents it. We send one after 15 s without audio, checked every 5 s so
 *   the worst-case gap between the idle threshold firing and the actual send
 *   stays well under the server's ~20 s timeout (checking on the same 15 s
 *   cadence as the threshold let the worst case approach 30 s).
 */

export interface SonioxToken {
  text: string;
  is_final?: boolean;
  translation_status?: 'original' | 'translation' | 'none';
  language?: string;
  source_language?: string;
  speaker?: string;
  start_ms?: number;
  end_ms?: number;
  confidence?: number;
}

export interface SonioxSttMessage {
  tokens?: SonioxToken[];
  finished?: boolean;
  error_code?: number | string;
  error_message?: string;
}

export type SonioxTranslationConfig =
  | { type: 'one_way'; target_language: string }
  | { type: 'two_way'; language_a: string; language_b: string };

export interface SonioxSttConfig {
  apiKey: string;
  model: string;
  sampleRate: number;
  languageHints?: string[];
  translation: SonioxTranslationConfig;
}

export interface SonioxSttStreamHandlers {
  onMessage?: (message: SonioxSttMessage) => void;
  onFinished?: () => void;
  onError?: (code: string, message: string) => void;
  onClose?: (event: { code?: number; reason?: string }) => void;
}

const STT_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
const CONNECTION_TIMEOUT_MS = 15000;
const KEEPALIVE_AFTER_IDLE_MS = 15000;
const KEEPALIVE_CHECK_INTERVAL_MS = 5000;

export class SonioxSttStream {
  private ws: WebSocket | null = null;
  private handlers: SonioxSttStreamHandlers = {};
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastAudioAt = 0;

  setHandlers(handlers: SonioxSttStreamHandlers): void {
    this.handlers = handlers;
  }

  connect(config: SonioxSttConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(STT_URL);
      this.ws = ws;
      let opened = false;
      const timer = setTimeout(() => {
        if (!opened) {
          ws.close();
          reject(new Error('Soniox STT connection timeout'));
        }
      }, CONNECTION_TIMEOUT_MS);

      ws.onopen = () => {
        opened = true;
        clearTimeout(timer);
        ws.send(JSON.stringify({
          api_key: config.apiKey,
          model: config.model,
          audio_format: 'pcm_s16le',
          sample_rate: config.sampleRate,
          num_channels: 1,
          enable_endpoint_detection: true,
          max_endpoint_delay_ms: 500,
          enable_language_identification: true,
          ...(config.languageHints?.length ? { language_hints: config.languageHints } : {}),
          translation: config.translation,
        }));
        this.lastAudioAt = Date.now();
        this.startKeepalive();
        resolve();
      };

      ws.onmessage = (event) => {
        let message: SonioxSttMessage;
        try {
          message = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (message.error_code != null) {
          this.handlers.onError?.(String(message.error_code), message.error_message ?? '');
          return;
        }
        this.handlers.onMessage?.(message);
        if (message.finished) this.handlers.onFinished?.();
      };

      ws.onerror = (error) => {
        clearTimeout(timer);
        if (!opened) {
          reject(error instanceof Error ? error : new Error('Soniox STT connection failed'));
        } else {
          this.handlers.onError?.('socket_error', String(error));
        }
      };

      ws.onclose = (event) => {
        clearTimeout(timer);
        this.stopKeepalive();
        this.handlers.onClose?.({ code: (event as CloseEvent).code, reason: (event as CloseEvent).reason });
      };
    });
  }

  sendAudio(audio: Int16Array): void {
    if (!this.isOpen()) return;
    this.lastAudioAt = Date.now();
    this.ws!.send(audio);
  }

  /** Finalize pending tokens without ending the session. */
  finalize(): void {
    if (!this.isOpen()) return;
    this.ws!.send(JSON.stringify({ type: 'finalize' }));
  }

  /** End the audio stream: the server flushes, sends {finished:true}, closes. */
  end(): void {
    if (!this.isOpen()) return;
    // Must be an empty TEXT frame — an empty binary frame is NOT recognized.
    this.ws!.send('');
  }

  close(): void {
    this.stopKeepalive();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (!this.isOpen()) return;
      if (Date.now() - this.lastAudioAt >= KEEPALIVE_AFTER_IDLE_MS) {
        this.ws!.send(JSON.stringify({ type: 'keepalive' }));
        this.lastAudioAt = Date.now();
      }
    }, KEEPALIVE_CHECK_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }
}
