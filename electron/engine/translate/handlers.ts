/**
 * The translation messages (port of translate_engine.py's handlers): translate_init and translate.
 *
 * Each translate call owns an AbortController, kept in its connection's set; the moment that connection's socket
 * closes, its calls — and only its calls — are aborted, mid-generation, and get no reply. (The connection's onClose
 * cleanups would only run once the call in flight had returned, so the abort hangs on waitClosed().) The connection
 * that ran translate_init also frees the model when it closes, unless a later init has superseded it.
 */
import { ledgerEffectiveReserve } from '../accel/ledger';
import { seams } from '../accel/seams';
import type { Conn } from '../conn';
import { exclusive, register as registerHandler, type EngineState, type Handler } from '../server';
import { TranslateEngine } from './engine';

/** What the handlers drive: the engine's public surface (a test can stand in a fake). */
export interface TranslateEngineLike {
  resolved?: Record<string, unknown> | null;
  readonly generation?: number;
  init(modelId: string | null, sourceLang: string, targetLang: string, device: string, reservedBytes: number, pin: string | null): Promise<number> | number;
  translate(text: string, systemPrompt: string, wrapTranscript: boolean, opts: { signal?: AbortSignal; onPartial?: (text: string) => void }): Promise<[string, number]> | [string, number];
  cancelActive?(): void;
  close?(): Promise<void> | void;
}

/** The process's one translation engine (Python's state["translate_engine"]). */
export function translateEngineOf(state: EngineState): TranslateEngineLike {
  if (!state.translate_engine) state.translate_engine = new TranslateEngine();
  return state.translate_engine as TranslateEngineLike;
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Frees the model when the connection that loaded it closes — unless a later init has replaced it since. */
export async function translateTeardown(state: EngineState, generation?: number): Promise<void> {
  const eng = state.translate_engine as TranslateEngineLike | undefined;
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

export const translateInitHandler: Handler = (state, msg, binary, conn) => exclusive(state, 'translate', () => initTranslate(state, msg, binary, conn));

const initTranslate: Handler = async (state, msg, _binary, conn) => {
  const eng = translateEngineOf(state);
  // A stage already loaded reserves nothing (its memory is out of every free reading); one not loaded yet reserves
  // its download size.
  const planned: Record<string, number> = {};
  for (const [stage, key] of [['asr', 'asrModel'], ['tts', 'ttsModel']] as const) {
    const id = msg[key];
    if (typeof id === 'string' && id) planned[stage] = seams.modelSize(id) ?? 0;
  }
  const reserve = ledgerEffectiveReserve('translate', planned);
  const ms = await eng.init(typeof msg.model === 'string' ? msg.model : null, str(msg.sourceLang), str(msg.targetLang), str(msg.device, 'auto'), reserve, typeof msg.variant === 'string' ? msg.variant : null);
  const generation = eng.generation;
  conn?.onClose(() => translateTeardown(state, generation));
  return [{ type: 'ready', id: msg.id, loadTimeMs: ms, ...(eng.resolved ?? {}) }, null];
};

/** This connection's translate calls in flight; the first call on a connection arms the abort-on-close. */
function callsOf(conn: Conn): Set<AbortController> {
  let calls = conn.ctx.get('translate_calls') as Set<AbortController> | undefined;
  if (!calls) {
    const set = new Set<AbortController>();
    calls = set;
    conn.ctx.set('translate_calls', set);
    void conn.waitClosed().then(() => {
      for (const c of set) c.abort();
    });
  }
  return calls;
}

export const translateHandler: Handler = async (state, msg, _binary, conn) => {
  const text = str(msg.text);
  const eng = translateEngineOf(state);
  const controller = new AbortController();
  const calls = conn ? callsOf(conn) : null;
  calls?.add(controller);
  if (conn?.closed) controller.abort();
  let reported = false;
  const onPartial = conn
    ? (partial: string) => {
      conn.send({ type: 'translate_partial', text: partial }).catch((e) => {
        if (reported) return;                       // one report per request
        reported = true;
        seams.log('error', `[engine] translate_partial send failed: ${errorText(e)}`);
      });
    }
    : undefined;
  try {
    const [translated, ms] = await eng.translate(text, str(msg.systemPrompt), Boolean(msg.wrapTranscript), { signal: controller.signal, onPartial });
    if (controller.signal.aborted && conn?.closed) return [null, null];   // the client is gone: nothing to answer
    return [{ type: 'translate_result', id: msg.id, sourceText: text, translatedText: translated, inferenceTimeMs: ms }, null];
  } catch (e) {
    if (conn?.closed) {
      seams.log('error', `[engine] translate cancel-on-disconnect: the call in flight failed: ${errorText(e)}`);
      return [null, null];
    }
    throw e;
  } finally {
    calls?.delete(controller);
  }
};

export function register(state: EngineState): void {
  translateEngineOf(state);
  registerHandler(state, 'translate_init', translateInitHandler);
  registerHandler(state, 'translate', translateHandler);
}
