/**
 * Soniox real-time TTS WebSocket wire component.
 *
 * Protocol-only: knows the Soniox TTS wire protocol and nothing about STT,
 * IClient or Sokuji semantics. Deliberately decoupled — it consumes a
 * (text, language) event stream from ANY source, which is the seam for
 * future cross-provider composition (e.g. another STT → Soniox TTS).
 *
 * Stream model:
 * - Streams are multiplexed over one WebSocket by stream_id. A stream is opened
 *   lazily by the first text that needs one (config message), fed
 *   {text, text_end:false} chunks, and closed with {text:"", text_end:true}.
 * - tts-rt-v2 kills a stream that lives too long, always as a 408 followed by
 *   {terminated} (measured live 2026-09-11; every language behaves alike):
 *     · "Request timeout" ~5.2 s after the stream's last TEXT frame — even
 *       while it is producing audio, and whatever it had not spoken yet is lost;
 *     · "no audio output within timeout" ~10–12 s after it opened, when the
 *       server has not started speaking (it holds short text until text_end);
 *     · "output audio rate below minimum" when its audio lags its age.
 *   {keep_alive} prevents none of them. So an utterance is spoken as a run of
 *   short SEGMENTS, one stream each (`utt-<utterance>-<segment>`), and a
 *   segment ends at the first of:
 *     1. a chunk that ends a sentence (classifyChunkEnd → 'sentence');
 *     2. a chunk that ends a clause, followed by clauseWaitMs with no new text
 *        while the server has produced no audio for the segment — it is
 *        holding the text, so hand it over rather than let the next clause
 *        pile on (a slow speaker otherwise hears one late lump);
 *     3. idleMs with no new text, unconditionally — guards the 5.2 s kill;
 *     4. maxAgeMs after the segment's first text ARRIVED (queued or not) —
 *        guards the no-audio kill;
 *     5. endUtterance().
 *   Translation arrives one clause-sized burst at a time, so every cut lands
 *   on a burst boundary. Once text_end is sent a stream only has to finish.
 * - Segments are serialized: the next opens only after the previous one's
 *   {terminated}, so audio never interleaves and at most one stream is open —
 *   one `tts_concurrent` slot per session. Text arriving meanwhile is queued.
 * - Frames sent to a stream before its 408 arrived come back as 400 "Stream …
 *   not found". Errors about a stream already dropped are ignored: its failure
 *   was reported once, when it died.
 * - {keep_alive:true} every 20 s keeps the CONNECTION open between utterances
 *   (NOTE: a different shape from the STT keepalive {"type":"keepalive"}). A
 *   socket with no stream on it is not closed by the server on its own; the
 *   caller still reconnects on demand for genuine drops.
 */
import { SONIOX_REDUCE_SILENCE } from '../../lib/soniox/ttsCatalog';
import { sonioxHosts, type SonioxRegion } from '../../lib/soniox/regions';

export interface SonioxTtsOptions {
  apiKey: string;
  /** Which Soniox deployment `apiKey` belongs to. Required, not defaulted, for
   *  the same reason as SonioxSttConfig.region: a key and a host are ONE
   *  credential. In a session this is always the STT leg's own region — both
   *  come off the same SonioxCredentialBundle. */
  region: SonioxRegion;
  voice: string;
  model: string;
  sampleRate: number;
  /** Speaking rate 0.7..1.3; undefined or 1.0 (the server default) is omitted from the wire. */
  speed?: number;
  // Managed-mode only: must match the STT stream's clientReferenceId, or the
  // TTS half of the session cannot be attributed to the billing lease.
  clientReferenceId?: string;
}

/**
 * 'stream': the server killed one stream and the socket is still up — the next
 * segment will speak. 'connection': the socket itself failed, or the error
 * named no stream.
 */
export type SonioxTtsErrorScope = 'stream' | 'connection';

export interface SonioxTtsStreamHandlers {
  onAudio?: (audio: Int16Array) => void;
  // hadActiveStream: whether a stream carrying utterance text (active or still
  // draining its final audio) existed at the moment of this error/close, as
  // opposed to a socket that was genuinely idle. The caller
  // (SonioxClient.handleTtsError) uses it to decide whether a drop cost any
  // spoken output at all, and `scope` to say how much.
  onError?: (code: string, message: string, hadActiveStream: boolean, scope: SonioxTtsErrorScope) => void;
}

/** Segment timing, measured against tts-rt-v2's kill timers (see the header). */
export const TTS_SEGMENT_TIMING = {
  /** After a clause end, how long to wait for more text before handing a held segment over. */
  clauseWaitMs: 1500,
  /** No new text for this long ends the segment — 2.2 s inside the 5.2 s kill. */
  idleMs: 3000,
  /** A segment's first text is never held longer — ~2.4 s inside the earliest no-audio kill. */
  maxAgeMs: 8000,
} as const;

// Sentence ends of every script tts-rt-v2 speaks, plus a few from scripts it
// does not (Ethiopic, Myanmar, Khmer, Armenian) that cannot occur by accident.
// U+037E is the Greek question mark; Greek text written with an ASCII ';'
// falls under CLAUSE_END instead, where a wrong guess costs only clauseWaitMs.
// U+037E and U+0387 (Greek ano teleia) are written as escapes because NFC —
// and many editors — fold them into ';' and U+00B7; CLAUSE_END lists both dots.
const SENTENCE_END = new Set([...'.!?…‼⁇⁈⁉‽。！？．｡؟۔।॥።፧။។։⋯', '\u037E']);
const CLAUSE_END = new Set([...',،؛;:、，；：፣၊', '\u00B7', '\u0387']);
// Quotes and brackets that may follow a sentence end: 「…です。」, "yes."
const CLOSERS = new Set([...'"\'”’»›)]}」』）］】〉》〕〗｣']);
// A period after a digit may be a decimal point split across two chunks
// ("3." + "5") — treated as a clause end, so the next chunk can still join.
const DECIMAL_POINTS = new Set(['.', '．']);

/** How a translation chunk ends: a full sentence, a clause, or neither. */
export function classifyChunkEnd(text: string): 'sentence' | 'clause' | null {
  const chars = [...text];
  let i = chars.length - 1;
  while (i >= 0 && (CLOSERS.has(chars[i]) || /\s/u.test(chars[i]))) i--;
  if (i < 0) return null;
  const last = chars[i];
  if (DECIMAL_POINTS.has(last) && i > 0 && /\p{Nd}/u.test(chars[i - 1])) return 'clause';
  if (SENTENCE_END.has(last)) return 'sentence';
  if (CLAUSE_END.has(last)) return 'clause';
  return null;
}

interface QueuedItem {
  kind: 'text' | 'end';
  text?: string;
  language?: string;
  /** When the text arrived — the segment's age counts from here even if it waited. */
  at?: number;
}

const CONNECTION_TIMEOUT_MS = 15000;
const KEEPALIVE_INTERVAL_MS = 20000;

export class SonioxTtsStream {
  private options: SonioxTtsOptions;
  private ws: WebSocket | null = null;
  private handlers: SonioxTtsStreamHandlers = {};
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  // Active segment state
  private activeStreamId: string | null = null;
  private activeLanguage: string | null = null;
  private activeHasAudio = false;       // has the server started speaking this segment?
  private drainingStreamId: string | null = null; // ended segment, terminated pending
  private queue: QueuedItem[] = [];
  private utteranceCounter = 0;
  private segmentCounter = 0;
  private utteranceOpen = false;        // the next segment continues the current utterance
  private clauseTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private maxAgeTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  constructor(options: SonioxTtsOptions) {
    this.options = options;
  }

  setHandlers(handlers: SonioxTtsStreamHandlers): void {
    this.handlers = handlers;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://${sonioxHosts(this.options.region).ttsRt}/tts-websocket`);
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
        const id = data.stream_id;
        const isLive = id === this.activeStreamId || id === this.drainingStreamId;
        if (data.error_code != null) {
          // An error about a stream already dropped is a frame that was in
          // flight when it died — its failure was reported then.
          if (id == null || isLive) {
            // Snapshot BEFORE handleStreamFailure clears it.
            const hadActiveStream = this.hasLiveStream();
            this.handlers.onError?.(String(data.error_code), data.error_message ?? '', hadActiveStream, id == null ? 'connection' : 'stream');
            this.handleStreamFailure(id);
          }
        } else if (data.audio && isLive) {
          if (id === this.activeStreamId) this.activeHasAudio = true;
          this.handlers.onAudio?.(this.base64ToInt16(data.audio));
        }
        // terminated must always be processed, even when the same message also
        // carried an error — otherwise a combined error+terminated frame would
        // leave drainingStreamId set and wedge the queue forever.
        if (data.terminated && id === this.drainingStreamId) {
          this.drainingStreamId = null;
          this.flushQueue();
        }
      };

      ws.onerror = (error) => {
        clearTimeout(timer);
        if (!opened) {
          reject(error instanceof Error ? error : new Error('Soniox TTS connection failed'));
        } else {
          this.handlers.onError?.('socket_error', String(error), this.hasLiveStream(), 'connection');
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
          const hadActiveStream = this.hasLiveStream();
          this.resetStreams();
          this.handlers.onError?.('socket_closed', 'Soniox TTS socket closed unexpectedly', hadActiveStream, 'connection');
        }
      };
    });
  }

  sendText(text: string, language: string): void {
    if (!this.isOpen()) return;
    const item: QueuedItem = { kind: 'text', text, language, at: Date.now() };
    if (this.drainingStreamId) {
      this.queue.push(item);
      return;
    }
    this.doSendText(item);
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
    this.clearSegmentTimers();
    this.queue = [];
    if (this.ws) {
      // Best-effort close of the active stream so the server frees it.
      if (this.activeStreamId) {
        try {
          this.ws.send(JSON.stringify({ stream_id: this.activeStreamId, text: '', text_end: true }));
        } catch { /* closing anyway */ }
      }
      this.ws.close();
      this.ws = null;
    }
    this.resetStreams();
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private hasLiveStream(): boolean {
    return this.activeStreamId !== null || this.drainingStreamId !== null;
  }

  private doSendText(item: QueuedItem): void {
    if (this.activeStreamId && this.activeLanguage !== item.language) {
      // A stream speaks one language: finish this segment, speak the new text
      // in the next. Put it back at the FRONT — flushQueue may hold later items.
      this.endSegment();
      this.queue.unshift(item);
      return;
    }
    if (!this.activeStreamId) this.openSegment(item.language!, item.at!);
    this.ws!.send(JSON.stringify({ stream_id: this.activeStreamId, text: item.text, text_end: false }));
    this.scheduleSegmentEnd(item.text!);
  }

  private doEndUtterance(): void {
    this.endSegment();
    this.utteranceOpen = false;
  }

  /** Apply rules 1–3 of the header after a chunk was sent. */
  private scheduleSegmentEnd(text: string): void {
    this.clearTimer('clauseTimer');
    this.clearTimer('idleTimer');
    const end = classifyChunkEnd(text);
    if (end === 'sentence') {
      this.endSegment();
      return;
    }
    const id = this.activeStreamId;
    if (end === 'clause') {
      this.clauseTimer = setTimeout(() => {
        this.clauseTimer = null;
        if (this.activeStreamId === id && !this.activeHasAudio) this.endSegment();
      }, TTS_SEGMENT_TIMING.clauseWaitMs);
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.activeStreamId === id) this.endSegment();
    }, TTS_SEGMENT_TIMING.idleMs);
  }

  private openSegment(language: string, firstTextAt: number): void {
    if (!this.utteranceOpen) {
      this.utteranceCounter += 1;
      this.segmentCounter = 0;
      this.utteranceOpen = true;
    }
    this.segmentCounter += 1;
    const streamId = `utt-${this.utteranceCounter}-${this.segmentCounter}`;
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
    this.activeHasAudio = false;
    // Rule 4. Counted from ARRIVAL: text that waited behind a draining segment
    // has already spent part of its budget.
    const left = Math.max(0, firstTextAt + TTS_SEGMENT_TIMING.maxAgeMs - Date.now());
    this.maxAgeTimer = setTimeout(() => {
      this.maxAgeTimer = null;
      if (this.activeStreamId === streamId) this.endSegment();
    }, left);
  }

  /** text_end the active segment; the next one waits for its terminated. */
  private endSegment(): void {
    if (!this.activeStreamId) return;
    this.clearSegmentTimers();
    this.ws!.send(JSON.stringify({ stream_id: this.activeStreamId, text: '', text_end: true }));
    this.drainingStreamId = this.activeStreamId;
    this.activeStreamId = null;
    this.activeLanguage = null;
    this.activeHasAudio = false;
  }

  /**
   * Reset stream state after a wire error so a wedged component never results:
   * the failing stream (whichever role it held) is forgotten, and anything
   * queued behind a draining stream is released. The utterance stays open, so
   * its next text opens the next segment of the same utterance.
   */
  private handleStreamFailure(streamId?: string): void {
    if (streamId === undefined) {
      // Connection-level error: no specific stream named, clear everything.
      this.clearSegmentTimers();
      this.activeStreamId = null;
      this.activeLanguage = null;
      this.activeHasAudio = false;
      this.drainingStreamId = null;
      this.flushQueue();
      return;
    }
    if (streamId === this.activeStreamId) {
      this.clearSegmentTimers();
      this.activeStreamId = null;
      this.activeLanguage = null;
      this.activeHasAudio = false;
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
        this.doSendText(item);
      } else {
        this.doEndUtterance();
      }
    }
  }

  private resetStreams(): void {
    this.clearSegmentTimers();
    this.activeStreamId = null;
    this.activeLanguage = null;
    this.activeHasAudio = false;
    this.drainingStreamId = null;
    this.queue = [];
    this.utteranceOpen = false;
  }

  private clearTimer(which: 'clauseTimer' | 'idleTimer' | 'maxAgeTimer'): void {
    const timer = this[which];
    if (timer) {
      clearTimeout(timer);
      this[which] = null;
    }
  }

  private clearSegmentTimers(): void {
    this.clearTimer('clauseTimer');
    this.clearTimer('idleTimer');
    this.clearTimer('maxAgeTimer');
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
