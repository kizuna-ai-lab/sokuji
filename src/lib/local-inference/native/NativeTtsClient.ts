import type { ServerMsg } from './nativeProtocol';
import { SidecarConnection, INIT_REQUEST_TIMEOUT_MS, SidecarTimeoutError, type ISidecarConnection } from './SidecarConnection';

/** A finished native synthesis. Shape-compatible with the WASM lane's TtsResult
 *  by construction, NOT by import — the two providers are peers and the native
 *  lane owns its own contracts (cf. TtsReady below; NativeAsrClient's NativeAsrResult). */
export interface NativeTtsResult { samples: Float32Array; sampleRate: number; generationTimeMs: number; }

/** Reject a streaming generate if no chunk/done arrives for this long (inactivity).
 *  Applies BETWEEN chunks; the first chunk gets the synthesis budget below,
 *  because it has to wait out a whole text chunk's synthesis. */
const TTS_STREAM_INACTIVITY_MS = 30_000;

/** Floor for a synthesis budget: what every generate got before the budget
 *  existed, so this change can only ever lengthen a timeout, never shorten one. */
const TTS_MIN_BUDGET_MS = 30_000;

/** Ceiling, so a sidecar that is genuinely wedged is still bounded. Five
 *  minutes on one sentence is already a broken configuration; the point is
 *  that it fails as a timeout rather than hanging forever. */
const TTS_MAX_BUDGET_MS = 300_000;

/** Rough speech rate used to turn a text length into an expected audio
 *  duration. Deliberately low (slow speech = longer estimate = more headroom);
 *  it only has to be the right order of magnitude, since the safety factor
 *  below absorbs the rest. */
const CHARS_PER_SECOND_OF_SPEECH = 12;

/** Multiplier on the estimate, covering the load-time RTF being measured on a
 *  different sentence than this one and the machine being busier now. */
const TTS_BUDGET_SAFETY = 2;

/** Assumed RTF when the sidecar reported none (older sidecar, or a family whose
 *  plan carried no measurement): the slowest family measured on the reference
 *  box (index_tts2, 7.87 on GB10 CPU), so an unknown model is budgeted like the
 *  worst known one rather than like a fast one. */
const TTS_ASSUMED_RTF = 8;

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
  family?: string;   // the resolved card's family (moss_tts_nano | qwen3_tts | omnivoice | pocket_tts | supertonic)
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
  private rtf = 0;                    // cached from the last init(); 0 = the sidecar reported none
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
    this.rtf = typeof r.rtf === 'number' && r.rtf > 0 ? r.rtf : 0;
    return {
      sampleRate: this.sampleRate, loadTimeMs: r.loadTimeMs,
      backend: r.backend, device: r.device, computeType: r.computeType, rtf: r.rtf,
      streaming: !!r.streaming, clones: !!r.clones, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason,
      family: r.family,
    };
  }

  /** Select a built-in voice by name (applies to subsequent generate calls). */
  async setVoice(name: string): Promise<void> { await this.conn.request({ type: 'set_voice', voice: name }); }

  async setReferenceVoice(audio: Float32Array, sampleRate: number, refText?: string): Promise<void> {
    this.conn.sendBinary(audio);                         // binary frame precedes the control message; pass the view so a subarray isn't over-sent
    await this.conn.request({ type: 'set_voice', sampleRate, ...(refText ? { refText } : {}) });
  }

  /** How long this synthesis may take before the renderer stops waiting.
   *  `rtf` here is the sidecar's own convention (synthesis time / audio
   *  duration, so 7.87 means "eight seconds of work per second of speech" --
   *  see nativeCatalog.formatRtf, which prints 1/rtf). A fixed timeout was
   *  fine while every family ran near real time; the cpu-only families added
   *  2026-09-03 do not, and the renderer timing out does not stop the work --
   *  offline synthesis in the sidecar runs to completion regardless, so the
   *  next request simply queues behind it. */
  private budgetMs(text: string): number {
    const estimatedAudioS = Math.max(1, text.length / CHARS_PER_SECOND_OF_SPEECH);
    const rtf = this.rtf > 0 ? this.rtf : TTS_ASSUMED_RTF;
    const budget = estimatedAudioS * rtf * TTS_BUDGET_SAFETY * 1000;
    return Math.min(TTS_MAX_BUDGET_MS, Math.max(TTS_MIN_BUDGET_MS, Math.round(budget)));
  }

  async generate(text: string, speed = 1.0, onChunk?: (pcm: Float32Array, seq: number) => void): Promise<NativeTtsResult> {
    if (this.streaming && onChunk) {
      const id = this.conn.nextId();
      this.inFlightId = id;
      this.streamHandlers.set(id, onChunk);
      const firstChunkMs = this.budgetMs(text);
      const done = await new Promise<ServerMsg>((resolve, reject) => {
        // Inactivity timeout: reset on each chunk (bump), so a long-but-progressing
        // stream isn't killed but a silent hang is bounded. Arrow fns keep `this`.
        // The FIRST arm is the synthesis budget, not the inactivity allowance:
        // the stream emits only once a pulled text chunk is fully synthesised,
        // so on a cpu-only family that first wait IS the synthesis (voxcpm2
        // measured 10.3s for 3.7s of audio; a longer sentence outlives 30s).
        let timer: ReturnType<typeof setTimeout>;
        const clear = () => clearTimeout(timer);
        const arm = (ms: number = TTS_STREAM_INACTIVITY_MS) => { timer = setTimeout(() => {
          this.streamDone.delete(id); this.streamHandlers.delete(id);
          reject(new SidecarTimeoutError('tts_generate', ms));
        }, ms); };
        arm(firstChunkMs);
        this.streamDone.set(id, {
          resolve: (m) => { clear(); resolve(m); },
          reject: (e) => { clear(); reject(e); },
          bump: () => { clear(); arm(); },   // between chunks: back to the tight inactivity allowance
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
    const msg = await this.conn.request({ type: 'tts_generate', text, speed }, { id, timeoutMs: this.budgetMs(text) });
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
