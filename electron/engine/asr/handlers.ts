/**
 * The ASR messages (port of asr_engine.py's handlers): asr_init (loads, routes the connection's binary frames to the
 * engine, and frees the model when the connection closes), asr_flush, and vad_mark (fire-and-forget).
 *
 * A frame or mark never waits for a transcription: the engine updates its buffers at once and the result is pushed
 * when its transcription finishes, so the connection keeps taking frames — in order — meanwhile.
 */
import type { Conn } from '../conn';
import { exclusive, register as registerHandler, type EngineState, type Handler } from '../server';
import { AsrEngine, type AsrEvent } from './engine';
import { SRC_RATE } from './dsp';

/** What the handlers drive: the engine's public surface (a test can stand in a fake). */
export interface AsrEngineLike {
  resolved?: Record<string, unknown> | null;
  readonly generation?: number;
  resolvesToStreaming?(modelId: string | null, device: string | null, pin?: string | null): Promise<boolean>;
  init(modelId: string | null, language: string, sampleRate: number, device: string, pin: string | null): Promise<number>;
  initStreaming?(modelId: string | null, language: string, sampleRate: number, device: string, pin: string | null): Promise<unknown>;
  feed(bytes: Uint8Array): Promise<AsrEvent[]> | AsrEvent[];
  feedStream?(bytes: Uint8Array | null): AsrEvent[];
  runStream?(send: (m: AsrEvent) => Promise<void>): Promise<void>;
  mark?(event: string): Promise<AsrEvent[]> | AsrEvent[];
  flush?(): Promise<AsrEvent[]> | AsrEvent[];
  close?(): Promise<void> | void;
}

/** The process's one ASR engine (Python's state["asr_engine"]). */
export function asrEngineOf(state: EngineState): AsrEngineLike {
  if (!state.asr_engine) state.asr_engine = new AsrEngine();
  return state.asr_engine as AsrEngineLike;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Sends a pending batch of events when it arrives; a failure becomes an error message on the connection. */
function deliver(conn: Conn | undefined, pending: Promise<AsrEvent[]> | AsrEvent[]): Promise<void> {
  return Promise.resolve(pending).then(
    async (events) => {
      for (const e of events) await conn?.send(e);
    },
    async (e) => {
      await conn?.send({ type: 'error', message: errorText(e) });
    },
  ).catch(() => {});                       // a send that fails has nowhere left to report
}

/**
 * Frees the model when the connection that loaded it closes — unless a later init has replaced it since (a reloaded
 * window's new socket loads before the old one's cleanup runs): then the model is the new session's, not this one's.
 */
async function teardown(state: EngineState, conn: Conn, generation?: number): Promise<void> {
  const eng = state.asr_engine as AsrEngineLike | undefined;
  if (generation !== undefined && eng?.generation !== undefined && eng.generation !== generation) return;
  try {
    await eng?.close?.();
  } catch {
    // best effort
  }
  const task = conn.ctx.get('stream_task') as Promise<void> | undefined;
  if (task) await task.catch(() => {});
}

export const asrInitHandler: Handler = (state, msg, binary, conn) => exclusive(state, 'asr', () => initAsr(state, msg, binary, conn));

const initAsr: Handler = async (state, msg, _binary, conn) => {
  if (conn?.closed) return [null, null];                            // queued behind another init and the client left: no one to own a model
  const eng = asrEngineOf(state);
  const model = typeof msg.model === 'string' ? msg.model : null;
  const device = typeof msg.device === 'string' ? msg.device : 'auto';
  const language = typeof msg.language === 'string' ? msg.language : '';
  const sampleRate = typeof msg.sampleRate === 'number' ? msg.sampleRate : SRC_RATE;
  const pin = typeof msg.variant === 'string' ? msg.variant : null;   // the user-pinned quant

  // Resolve the backend's name without loading, so each path loads the model exactly once.
  const streaming = eng.resolvesToStreaming !== undefined && await eng.resolvesToStreaming(model, device, pin);
  let ms = 0;
  let generation: number | undefined;
  // True once another connection's init has replaced the model this connection loaded: its frames must not reach it.
  const stale = () => generation !== undefined && eng.generation !== undefined && eng.generation !== generation;
  if (streaming) {
    await eng.initStreaming!(model, language, sampleRate, device, pin);
    generation = eng.generation;
    conn?.ctx.set('asr_generation', generation);
    if (conn) {
      conn.ctx.set('on_binary', (data: Uint8Array) => (stale() ? [] : eng.feedStream!(data)));
      conn.ctx.set('stream_task', eng.runStream!((m) => conn.send(m)));
      conn.onClose(() => teardown(state, conn, generation));
    }
  } else {
    ms = await eng.init(model, language, sampleRate, device, pin);
    generation = eng.generation;
    conn?.ctx.set('asr_generation', generation);
    if (conn) {
      conn.ctx.set('on_binary', (data: Uint8Array) => {
        if (stale()) return [];                                           // a later init owns the model now
        void deliver(conn, eng.feed(data));
        return [];
      });
      conn.onClose(() => teardown(state, conn, generation));
    }
  }
  return [{ type: 'ready', id: msg.id, loadTimeMs: ms, ...(eng.resolved ?? {}) }, null];
};

/** False when a later init (another connection's) has replaced the model this connection loaded. */
function ownsModel(eng: AsrEngineLike, conn: Conn | undefined): boolean {
  const mine = conn?.ctx.get('asr_generation') as number | undefined;
  return mine === undefined || eng.generation === undefined || eng.generation === mine;
}

export const asrFlushHandler: Handler = async (state, msg, _binary, conn) => {
  const eng = asrEngineOf(state);
  if (!ownsModel(eng, conn)) return [{ type: 'ok', id: msg.id }, null];
  for (const out of await (eng.flush?.() ?? [])) await conn?.send(out);
  return [{ type: 'ok', id: msg.id }, null];
};

/** A client VAD edge: no id and no reply; an end mark's result is pushed when its transcription finishes. */
export const vadMarkHandler: Handler = async (state, msg, _binary, conn) => {
  const eng = asrEngineOf(state);
  if (!ownsModel(eng, conn)) return [null, null];
  void deliver(conn, eng.mark?.(String(msg.event ?? '')) ?? []);
  return [null, null];
};

export function register(state: EngineState): void {
  asrEngineOf(state);
  registerHandler(state, 'asr_init', asrInitHandler);
  registerHandler(state, 'asr_flush', asrFlushHandler);
  registerHandler(state, 'vad_mark', vadMarkHandler);
}
