/**
 * The engine's utilityProcess entry. Main forks dist-electron/engine.js; this reads its env, starts the engine and
 * talks to main over `parentPort`:
 *   engine → main  { type: 'ready', port } | { type: 'failed', error } | { type: 'log', level, message }
 *                  | { type: 'pong', seq } | { type: 'stuck', job }
 *   main → engine  { type: 'ping', seq } | { type: 'stop' }
 * Env: SOKUJI_NATIVE_DIR (required), SOKUJI_ENGINE_ORIGINS (comma-separated; `null` is never allowed).
 */
import { setStuckHandler } from './deadline';
import { startEngine, type EngineOptions } from './main';

export interface ParentPortLike {
  postMessage(message: Record<string, unknown>): void;
  on(event: 'message', listener: (e: { data: Record<string, unknown> }) => void): unknown;
}

export interface EntryDeps {
  port: ParentPortLike;
  env: Record<string, string | undefined>;
  exit: (code: number) => void;
  start?: (opts: EngineOptions) => Promise<{ port: number; close(): Promise<void> }>;
}

export async function runEntry(deps: EntryDeps): Promise<void> {
  const { port, env, exit } = deps;
  const start = deps.start ?? startEngine;
  const log: EngineOptions['log'] = (level, message) => port.postMessage({ type: 'log', level, message });
  setStuckHandler((job) => port.postMessage({ type: 'stuck', job }));

  let engine: { port: number; close(): Promise<void> } | null = null;
  port.on('message', ({ data }) => {
    if (data?.type === 'ping') {
      port.postMessage({ type: 'pong', seq: data.seq });
    } else if (data?.type === 'stop') {
      void (async () => {
        try { await engine?.close(); } catch { /* exiting anyway */ }
        exit(0);
      })();
    }
  });

  const nativeDir = env.SOKUJI_NATIVE_DIR;
  if (!nativeDir) {
    port.postMessage({ type: 'failed', error: 'SOKUJI_NATIVE_DIR is not set' });
    return;
  }
  const allowedOrigins = (env.SOKUJI_ENGINE_ORIGINS ?? '').split(',').map((o) => o.trim()).filter((o) => o !== '' && o !== 'null');
  try {
    engine = await start({ nativeDir, allowedOrigins, log });
    port.postMessage({ type: 'ready', port: engine.port });
  } catch (e) {
    port.postMessage({ type: 'failed', error: e instanceof Error ? e.message : String(e) });
  }
}

// Inside Electron's utilityProcess `process.parentPort` exists; under test and Node it does not.
const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (parentPort) void runEntry({ port: parentPort, env: process.env, exit: (c) => process.exit(c) });
