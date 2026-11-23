/**
 * The engine's entry (port of sidecar/sokuji_sidecar/__main__.py's _run): loads the addon, registers every stage's
 * handlers on one shared state, and serves it. The utilityProcess glue that prints the port is the switch plan's.
 */
import { loadNative, setNativeLog, useNative, type NativeModule } from './native';
import { register as registerAccel } from './accel/handlers';
import { register as registerModels } from './models/handlers';
import { register as registerAsr } from './asr/handlers';
import { register as registerTranslate } from './translate/handlers';
import { register as registerTts } from './tts/handlers';
import { seams } from './accel/seams';
import { createState, serve, type EngineState, type Log } from './server';

export interface EngineOptions {
  /** The directory holding sokuji_native_node.node and its contract.json. */
  nativeDir: string;
  /** Origins a browser may connect from; a connection with no Origin header is always taken. */
  allowedOrigins: string[];
  log: Log;
  /** An addon to use instead of loading one (tests). */
  native?: NativeModule;
}

/** Every stage's handlers, registered on `state`. Each stage's task adds its own. */
export function registerAll(state: EngineState): void {
  registerAccel(state);
  registerModels(state);
  registerAsr(state);
  registerTranslate(state);
  registerTts(state);
}

export async function startEngine(opts: EngineOptions): Promise<{ port: number; close(): Promise<void> }> {
  setNativeLog(opts.log);
  seams.log = opts.log;                      // the stages' own log lines (accel, ASR, …) go where the server's do
  useNative(opts.native ?? loadNative(opts.nativeDir), opts.nativeDir);
  const state = createState();
  registerAll(state);
  return serve(state, { allowedOrigins: opts.allowedOrigins, log: opts.log });
}
