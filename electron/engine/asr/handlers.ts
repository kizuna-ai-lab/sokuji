/**
 * The ASR messages (port of asr_engine.py's handlers): asr_init (loads, routes the connection's binary frames to the
 * engine, and frees the model when the connection closes), asr_flush, and vad_mark (fire-and-forget).
 *
 * A frame or mark never waits for a transcription: the engine updates its buffers at once and the result is pushed
 * when its transcription finishes, so the connection keeps taking frames — in order — meanwhile.
 */
import type { Conn } from '../conn';
import { register as registerHandler, type EngineState, type Handler } from '../server';
import { AsrEngine, type AsrEvent } from './engine';
import { SRC_RATE } from './dsp';

/** What the handlers drive: the engine's public surface (a test can stand in a fake). */
export interface AsrEngineLike {
  resolved?: Record<string, unknown> | null;
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

/** Frees this connection's model when it closes: the streaming loop first, then the engine's model. */
async function teardown(state: EngineState, conn: Conn): Promise<void> {
  const eng = state.asr_engine as AsrEngineLike | undefined;
  try {
    await eng?.close?.();
  } catch {
    // best effort
  }
  const task = conn.ctx.get('stream_task') as Promise<void> | undefined;
  if (task) await task.catch(() => {});
}

export const asrInitHandler: Handler = async (state, msg, _binary, conn) => {
  const eng = asrEngineOf(state);
  const model = typeof msg.model === 'string' ? msg.model : null;
  const device = typeof msg.device === 'string' ? msg.device : 'auto';
  const language = typeof msg.language === 'string' ? msg.language : '';
  const sampleRate = typeof msg.sampleRate === 'number' ? msg.sampleRate : SRC_RATE;
  const pin = typeof msg.variant === 'string' ? msg.variant : null;   // the user-pinned quant

  // Resolve the backend's name without loading, so each path loads the model exactly once.
  const streaming = eng.resolvesToStreaming !== undefined && await eng.resolvesToStreaming(model, device, pin);
  let ms = 0;
  if (streaming) {
    await eng.initStreaming!(model, language, sampleRate, device, pin);
    if (conn) {
      conn.ctx.set('on_binary', (data: Uint8Array) => eng.feedStream!(data));
      conn.ctx.set('stream_task', eng.runStream!((m) => conn.send(m)));
      conn.onClose(() => teardown(state, conn));
    }
  } else {
    ms = await eng.init(model, language, sampleRate, device, pin);
    if (conn) {
      conn.ctx.set('on_binary', (data: Uint8Array) => {
        void deliver(conn, eng.feed(data));
        return [];
      });
      conn.onClose(() => teardown(state, conn));
    }
  }
  return [{ type: 'ready', id: msg.id, loadTimeMs: ms, ...(eng.resolved ?? {}) }, null];
};

export const asrFlushHandler: Handler = async (state, msg, _binary, conn) => {
  const eng = asrEngineOf(state);
  for (const out of await (eng.flush?.() ?? [])) await conn?.send(out);
  return [{ type: 'ok', id: msg.id }, null];
};

/** A client VAD edge: no id and no reply; an end mark's result is pushed when its transcription finishes. */
export const vadMarkHandler: Handler = async (state, msg, _binary, conn) => {
  const eng = asrEngineOf(state);
  void deliver(conn, eng.mark?.(String(msg.event ?? '')) ?? []);
  return [null, null];
};

export function register(state: EngineState): void {
  asrEngineOf(state);
  registerHandler(state, 'asr_init', asrInitHandler);
  registerHandler(state, 'asr_flush', asrFlushHandler);
  registerHandler(state, 'vad_mark', vadMarkHandler);
}
