import type { TtsResult } from '../engine/TtsEngine';
import type { ServerMsg } from './nativeProtocol';
import { SidecarConnection, INIT_REQUEST_TIMEOUT_MS, SidecarTimeoutError, type ISidecarConnection } from './SidecarConnection';

/** Reject a streaming generate if no chunk/done arrives for this long (inactivity). */
const TTS_STREAM_INACTIVITY_MS = 30_000;

/**
 * The sidecar emits binary PCM as Int16 mono @ 24 kHz.
 * Convert Int16 bytes to Float32 samples (range [-1, 1]).
 */
function int16ToFloat32(buf: ArrayBuffer): Float32Array {
  const i16 = new Int16Array(buf);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
  return f32;
}

export interface TtsReady {
  sampleRate: number; loadTimeMs: number;
  backend?: string; device?: string; computeType?: string; rtf?: number;
  streaming: boolean; clones: boolean; memoryBytes?: number; fallbackReason?: string;
}

interface StreamDone { resolve: (m: ServerMsg) => void; reject: (e: Error) => void; bump: () => void; }

export class NativeTtsClient {
  onStatus: ((m: string) => void) | null = null;
  onError: ((e: string) => void) | null = null;
  private conn: ISidecarConnection;
  private lastBinary: ArrayBuffer | null = null;
  private streamHandlers = new Map<number, (pcm: Float32Array, seq: number) => void>();
  private streamDone = new Map<number, StreamDone>();
  private streaming = false;          // cached from the last init()
  private sampleRate = 24000;         // cached from the last init() (sidecar's PCM rate)
  private inFlightId = 0;             // id of the current generate (for cancel())

  constructor(conn: ISidecarConnection = new SidecarConnection()) {
    this.conn = conn;
    this.conn.onBinary((buf) => { this.lastBinary = buf; });
    this.conn.onMessage((msg) => this.onPush(msg));
    // Streaming generate is client-owned correlation state (uses send(), not
    // request()), so the connection can't reject it — do it here on disconnect.
    this.conn.onClose((err) => this.rejectStreams(err));
  }

  private onPush(msg: ServerMsg): void {
    const id = (msg as { id?: number }).id;
    if (msg.type === 'tts_chunk') {
      this.streamDone.get(id as number)?.bump();
      const onChunk = this.streamHandlers.get(id as number);
      if (onChunk && this.lastBinary) { onChunk(int16ToFloat32(this.lastBinary), msg.seq); this.lastBinary = null; }
      return;
    }
    if (msg.type === 'tts_done') {
      this.streamHandlers.delete(id as number);
      const d = this.streamDone.get(id as number);
      this.streamDone.delete(id as number);
      d?.resolve(msg);
      return;
    }
    if (msg.type === 'error') {
      // A streaming generate is correlated by id (it uses send(), so its error never
      // matched a pending request). Reject that stream — its caller surfaces the
      // failure — instead of also firing onError. Only id-less push errors hit onError.
      if (typeof id === 'number' && this.streamDone.has(id)) {
        const d = this.streamDone.get(id)!;
        this.streamDone.delete(id); this.streamHandlers.delete(id);
        d.reject(new Error(msg.message));
      } else {
        this.onError?.(msg.message);
      }
      return;
    }
  }

  private rejectStreams(err: Error): void {
    for (const d of this.streamDone.values()) d.reject(err);
    this.streamDone.clear(); this.streamHandlers.clear(); this.lastBinary = null;
  }

  async init(model?: string, device?: string, language?: string, variant?: string): Promise<TtsReady> {
    this.onStatus?.('[native-tts] init…');
    // language = the session's target language. Backends with per-language
    // frontends (gpt_sovits_onnx G2P) need it; others ignore it. Omitting it
    // made zh/ja text run through the English G2P → "no audio" (live repro).
    // variant = the user-pinned compute type (e.g. 'bf16') for multi-variant
    // TTS cards (qwen3-tts) — mirrors asr_init's field so load resolves the
    // same repo download picked.
    const msg = await this.conn.request({ type: 'tts_init', model, device, language, variant }, { timeoutMs: INIT_REQUEST_TIMEOUT_MS });
    const r = msg as Extract<ServerMsg, { type: 'ready' }>;
    this.streaming = !!r.streaming;
    this.sampleRate = r.sampleRate ?? 24000;
    return {
      sampleRate: this.sampleRate, loadTimeMs: r.loadTimeMs,
      backend: r.backend, device: r.device, computeType: r.computeType, rtf: r.rtf,
      streaming: !!r.streaming, clones: !!r.clones, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason,
    };
  }

  /** Select a built-in voice by name (applies to subsequent generate calls). */
  async setVoice(name: string): Promise<void> { await this.conn.request({ type: 'set_voice', voice: name }); }

  /** Select a numeric speaker id (range models). */
  async setSpeaker(sid: number): Promise<void> { await this.conn.request({ type: 'set_voice', sid }); }

  async setReferenceVoice(audio: Float32Array, sampleRate: number, refText?: string): Promise<void> {
    this.conn.sendBinary(audio);                         // binary frame precedes the control message; pass the view so a subarray isn't over-sent
    await this.conn.request({ type: 'set_voice', sampleRate, ...(refText ? { refText } : {}) });
  }

  /** Select a style-cloned voice (e.g. Supertonic) from precomputed style-conditioning vectors. */
  async setStyleVoice(styleTtl: { dims: number[]; data: number[] },
                      styleDp: { dims: number[]; data: number[] }): Promise<void> {
    // Voice JSON `data` is nested per dims — flatten it (mirrors the WASM worker's
    // jsonToFloat32Tensor) before packing; otherwise Float32Array.from over the outer
    // array yields the wrong length and the sidecar's reshape fails.
    const f32 = (d: number[]) => Float32Array.from((d as unknown[]).flat(Infinity) as number[]);
    const ttl = f32(styleTtl.data), dp = f32(styleDp.data);
    const buf = new Float32Array(ttl.length + dp.length);
    buf.set(ttl, 0); buf.set(dp, ttl.length);
    this.conn.sendBinary(buf);                           // binary frame precedes the control message; pass the view so a subarray isn't over-sent
    await this.conn.request({ type: 'set_voice', styleVoice: { ttlDims: styleTtl.dims, dpDims: styleDp.dims } });
  }

  async generate(text: string, speed = 1.0, onChunk?: (pcm: Float32Array, seq: number) => void): Promise<TtsResult> {
    if (this.streaming && onChunk) {
      const id = this.conn.nextId();
      this.inFlightId = id;
      this.streamHandlers.set(id, onChunk);
      const done = await new Promise<ServerMsg>((resolve, reject) => {
        // Inactivity timeout: reset on each chunk (bump), so a long-but-progressing
        // stream isn't killed but a silent hang is bounded. Arrow fns keep `this`.
        let timer: ReturnType<typeof setTimeout>;
        const clear = () => clearTimeout(timer);
        const arm = () => { timer = setTimeout(() => {
          this.streamDone.delete(id); this.streamHandlers.delete(id);
          reject(new SidecarTimeoutError('tts_generate', TTS_STREAM_INACTIVITY_MS));
        }, TTS_STREAM_INACTIVITY_MS); };
        arm();
        this.streamDone.set(id, {
          resolve: (m) => { clear(); resolve(m); },
          reject: (e) => { clear(); reject(e); },
          bump: () => { clear(); arm(); },
        });
        this.conn.send({ type: 'tts_generate', text, speed, id });
      });
      const d = done as Extract<ServerMsg, { type: 'tts_done' }>;
      return { samples: new Float32Array(0), sampleRate: this.sampleRate, generationTimeMs: d.generationTimeMs };
    }
    // One-shot: the sidecar sends the PCM binary frame, then the result meta.
    const id = this.conn.nextId();
    this.inFlightId = id;
    this.lastBinary = null;
    const msg = await this.conn.request({ type: 'tts_generate', text, speed }, { id });
    const r = msg as Extract<ServerMsg, { type: 'tts_generate_result' }>;
    const binary = this.lastBinary; this.lastBinary = null;
    return { samples: int16ToFloat32(binary!), sampleRate: r.sampleRate, generationTimeMs: r.generationTimeMs };
  }

  cancel(): void {
    if (this.inFlightId) this.conn.send({ type: 'tts_cancel', id: this.inFlightId });
  }

  dispose(): void {
    this.rejectStreams(new Error('native host disconnected'));
    this.conn.dispose();
  }
}
