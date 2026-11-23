/**
 * The TTS messages (port of tts_engine.py's handlers): tts_init, set_voice, tts_generate, tts_cancel, list_tts_voices.
 *
 * Only the connection that loaded the model may generate or cancel (another gets not_owner); a tts_init from another
 * connection loads afresh and takes ownership. A generation — streaming or one-shot — runs in the background with its
 * own AbortController, so the connection stays free for tts_cancel (a connection's messages are handled one at a
 * time): a streaming one pushes tts_chunk … tts_done, a one-shot one pushes its PCM and tts_generate_result, or nothing
 * once cancelled. A new tts_generate supersedes the running one; the owner disconnecting stops it at once.
 */
import type { Conn } from '../conn';
import { register as registerHandler, type EngineState, type Handler } from '../server';
import { TtsEngine } from './engine';
import { listBuiltinVoices, type VoicesEngine } from './voices';

/** What the handlers drive: the engine's public surface (a test can stand in a fake). */
export interface TtsEngineLike extends Partial<VoicesEngine> {
  readonly sampleRate?: number;
  readonly streaming?: boolean;
  resolved?: Record<string, unknown> | null;
  ownerConn?: Conn | null;
  readonly generation?: number;
  nextGeneration?(): number;
  init?(modelId: string | null, device: string, language: string, pin: string | null, generation?: number): Promise<number> | number;
  setVoice?(audio: Float32Array, sampleRate: number, refText: string | null): Promise<void> | void;
  setBuiltinVoice?(name: string): Promise<void> | void;
  generate?(text: string, speed: number, signal?: AbortSignal): Promise<[Uint8Array, number]>;
  generateStream?(text: string, speed: number, send: (m: Record<string, unknown>, b?: Uint8Array | null) => Promise<void>, signal: AbortSignal | undefined, msgId: unknown): Promise<void>;
  cancelActive?(): void;
  close?(): Promise<void> | void;
}

/** The process's one TTS engine (Python's state["tts_engine"]). */
export function ttsEngineOf(state: EngineState): TtsEngineLike {
  if (!state.tts_engine) state.tts_engine = new TtsEngine();
  return state.tts_engine as TtsEngineLike;
}

/** The generation running on a connection. */
export interface ActiveGeneration {
  readonly mid: unknown;
  readonly controller: AbortController;
  readonly task: Promise<void>;
}

export const activeOf = (conn: Conn): ActiveGeneration | undefined => conn.ctx.get('tts_active') as ActiveGeneration | undefined;

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const notOwner = (id: unknown, type: string) => ({ type: 'error', id, message: `not_owner: ${type} from a connection that does not own the loaded TTS model` });
const isForeign = (eng: TtsEngineLike, conn: Conn | undefined) => Boolean(eng.ownerConn && conn && conn !== eng.ownerConn);

/**
 * Frees the model when the connection that loaded it closes: its generation stops first; then, unless a later init has
 * replaced the model since, the backend's newest synth is aborted and the engine closed.
 */
export async function ttsTeardown(state: EngineState, conn: Conn | null, generation?: number): Promise<void> {
  if (conn) activeOf(conn)?.controller.abort();
  const eng = state.tts_engine as TtsEngineLike | undefined;
  if (!eng) return;
  if (generation !== undefined && eng.generation !== undefined && eng.generation !== generation) return;
  try {
    eng.cancelActive?.();
  } catch {
    // close() below still frees it
  }
  try {
    await eng.close?.();
  } catch {
    // best effort
  }
}

export const ttsInitHandler: Handler = async (state, msg, _binary, conn) => {
  const eng = ttsEngineOf(state);
  const generation = eng.nextGeneration?.();                          // taken before the load, as Python's M5b does
  const ms = await eng.init!(typeof msg.model === 'string' ? msg.model : null, str(msg.device, 'auto'), str(msg.language), typeof msg.variant === 'string' ? msg.variant : null, generation);
  eng.ownerConn = conn ?? null;
  conn?.onClose(() => ttsTeardown(state, conn, generation));
  return [{ type: 'ready', id: msg.id, sampleRate: eng.sampleRate, loadTimeMs: ms, ...(eng.resolved ?? {}) }, null];
};

export const setVoiceHandler: Handler = async (state, msg, binaryIn) => {
  const eng = ttsEngineOf(state);
  const name = msg.voice;
  if (name) {
    await eng.setBuiltinVoice!(String(name));
  } else {
    let audio = new Float32Array(0);
    if (binaryIn && binaryIn.byteLength > 0) {
      if (binaryIn.byteLength % 4 !== 0) throw new Error('buffer size must be a multiple of element size');
      audio = new Float32Array(binaryIn.slice().buffer);              // copied: the frame need not be 4-byte aligned
    }
    const sampleRate = typeof msg.sampleRate === 'number' ? msg.sampleRate : 24000;
    await eng.setVoice!(audio, sampleRate, typeof msg.refText === 'string' ? msg.refText : null);
  }
  return [{ type: 'ok', id: msg.id }, null];
};

/** Arms, once per connection, the abort of its running generation the moment its socket closes. */
function armCloseAbort(conn: Conn): void {
  if (conn.ctx.get('tts_close_armed')) return;
  conn.ctx.set('tts_close_armed', true);
  void conn.waitClosed().then(() => activeOf(conn)?.controller.abort());
}

export const ttsGenerateHandler: Handler = async (state, msg, _binary, conn) => {
  const eng = ttsEngineOf(state);
  const text = str(msg.text);
  const speed = typeof msg.speed === 'number' ? msg.speed : 1.0;
  const mid = msg.id;
  if (isForeign(eng, conn)) return [notOwner(mid, 'tts_generate'), null];
  if (!conn) {
    const [pcm, ms] = await eng.generate!(text, speed);
    return [{ type: 'tts_generate_result', id: mid, sampleRate: eng.sampleRate, generationTimeMs: ms, samples: pcm.length / 2 }, pcm];
  }
  const prior = activeOf(conn);
  if (prior) {                                                        // superseded: stop it before starting the next
    prior.controller.abort();
    eng.cancelActive?.();
  }
  armCloseAbort(conn);
  const controller = new AbortController();
  const send = (m: Record<string, unknown>, b?: Uint8Array | null) => conn.send(m, b ?? null);
  const run = async () => {
    if (eng.streaming) {
      await eng.generateStream!(text, speed, send, controller.signal, mid);
      return;
    }
    try {
      const [pcm, ms] = await eng.generate!(text, speed, controller.signal);
      if (controller.signal.aborted) return;                         // cancelled: no result
      await send({ type: 'tts_generate_result', id: mid, sampleRate: eng.sampleRate, generationTimeMs: ms, samples: pcm.length / 2 }, pcm);
    } catch (e) {
      if (!controller.signal.aborted) await send({ type: 'error', id: mid, message: errorText(e) });
    }
  };
  const entry: ActiveGeneration = {
    mid,
    controller,
    task: run().catch(() => {}).finally(() => {
      if (activeOf(conn) === entry) conn.ctx.delete('tts_active');
    }),
  };
  conn.ctx.set('tts_active', entry);
  return [null, null];
};

export const ttsCancelHandler: Handler = async (state, msg, _binary, conn) => {
  const mid = msg.id;
  const eng = state.tts_engine as TtsEngineLike | undefined;
  if (eng && isForeign(eng, conn)) return [notOwner(mid, 'tts_cancel'), null];
  const active = conn ? activeOf(conn) : undefined;
  if (active && mid !== undefined && mid !== null && active.mid === mid) {
    active.controller.abort();
    eng?.cancelActive?.();
  }
  return [{ type: 'ok', id: mid }, null];
};

export const listTtsVoicesHandler: Handler = async (state, msg) => {
  const voices = await listBuiltinVoices(typeof msg.model === 'string' ? msg.model : null, (state.tts_engine as VoicesEngine | undefined) ?? null);
  return [{ type: 'list_tts_voices_result', id: msg.id, voices }, null];
};

export function register(state: EngineState): void {
  ttsEngineOf(state);
  registerHandler(state, 'tts_init', ttsInitHandler);
  registerHandler(state, 'set_voice', setVoiceHandler);
  registerHandler(state, 'tts_generate', ttsGenerateHandler);
  registerHandler(state, 'tts_cancel', ttsCancelHandler);
  registerHandler(state, 'list_tts_voices', listTtsVoicesHandler);
}
