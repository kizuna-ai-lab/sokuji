/// <reference lib="webworker" />
import init, { TokenizerBuilder, type Tokenizer } from 'lindera-wasm-ipadic-web';
import type { JaToken } from './furigana';
import type { FromLinderaWorker, ToLinderaWorker } from './protocol';

// Instantiated from the bytes the app stored, never fetched: the build strips the
// glue's own wasm URL (vite.lindera-wasm-url.ts).
let tokenizer: Tokenizer | null = null;
const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: FromLinderaWorker) => scope.postMessage(msg);

scope.onmessage = async (e: MessageEvent<ToLinderaWorker>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      await init({ module_or_path: msg.wasm });
      const builder = new TokenizerBuilder();
      builder.setDictionary('embedded://ipadic');
      builder.setMode('normal');
      tokenizer = builder.build();
      post({ type: 'ready' });
    } catch (err) {
      post({ type: 'failed', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (!tokenizer) {
    post({ type: 'tokens', id: msg.id, tokens: null });
    return;
  }
  const tokens: JaToken[] = tokenizer.tokenize(msg.text).map((t) => {
    const reading = t.details[7];
    const token = { surface: t.surface, reading: reading && reading !== '*' ? reading : null, unknown: t.is_unknown };
    t.free();
    return token;
  });
  post({ type: 'tokens', id: msg.id, tokens });
};
