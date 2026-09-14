// Node-side loader shared by the evaluation and parity scripts. The benchmark has
// no node_modules of its own, so onnxruntime-web (the exact build the app ships)
// and @huggingface/tokenizers come from the Sokuji checkout.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const NODE_MODULES = process.env.SOKUJI_NODE_MODULES ?? '/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules';

export const ort = await import(join(NODE_MODULES, 'onnxruntime-web/dist/ort.node.min.mjs'));
export const { Tokenizer } = await import(join(NODE_MODULES, '@huggingface/tokenizers/dist/tokenizers.mjs'));

/** A `readFile(name)` rooted at `dir`, returning bytes — the same shape the browser page passes. */
export const fileReader = (dir) => async (name) => new Uint8Array(await readFile(join(dir, name)));

/**
 * Instantiate models/<id>.mjs against its local directory on the WASM EP.
 * `threads` > 1 needs the caller to be a module file, not `node -e`: ORT's
 * worker re-imports the entry module by URL.
 */
export async function loadModel(id, { threads = 1, dir } = {}) {
  ort.env.wasm.numThreads = threads;
  const mod = await import(new URL(`../models/${id}.mjs`, import.meta.url).href);
  const t0 = performance.now();
  const model = await mod.create({
    ort,
    Tokenizer,
    readFile: fileReader(dir ?? mod.info.localDir),
    executionProviders: ['wasm'],
  });
  return { info: mod.info, model, loadMs: performance.now() - t0 };
}
