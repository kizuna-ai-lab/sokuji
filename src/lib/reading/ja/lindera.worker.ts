/// <reference lib="webworker" />
import init from 'lindera-wasm';
import { startEngine, type JaEngine } from './engine';
import type { JaToken } from './furigana';
import type { FromLinderaWorker, ToLinderaWorker } from './protocol';

// Lindera's wasm ships in the build: the glue names it `new URL('lindera_wasm_bg.wasm',
// import.meta.url)`, which Vite emits as an asset beside this worker
// (scripts/check-lindera-assets.mjs checks every build has it). Browser stores take a
// wasm fetched from elsewhere for remotely hosted code. The dictionary is data: the
// app downloads it (dictionary.ts) and hands its archive here.
let engine: JaEngine | null = null;
const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: FromLinderaWorker) => scope.postMessage(msg);

scope.onmessage = async (e: MessageEvent<ToLinderaWorker>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      await init();
      engine = await startEngine(msg.dictionary);
      post({ type: 'ready' });
    } catch (err) {
      post({ type: 'failed', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (!engine) {
    post({ type: 'tokens', id: msg.id, tokens: null });
    return;
  }
  let tokens: JaToken[] | null;
  try {
    tokens = engine.tokenize(msg.text);
  } catch {
    tokens = null;
  }
  post({ type: 'tokens', id: msg.id, tokens });
};
