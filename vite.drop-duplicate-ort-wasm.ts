import type { Plugin } from 'vite'

/**
 * Rollup emits hashed ort-wasm-*.wasm assets because onnxruntime-web uses
 * `new URL('...wasm', import.meta.url)`. Sokuji's workers set ORT's
 * `wasmPaths` to the canonical files under wasm/ort/, so those emitted assets
 * are unreachable duplicates of files copied from public/wasm/ort/.
 */
export function dropDuplicateOrtWasm(): Plugin {
  return {
    name: 'drop-duplicate-ort-wasm',
    generateBundle(_, bundle) {
      for (const key of Object.keys(bundle)) {
        if (key.includes('ort-wasm') && key.endsWith('.wasm')) {
          delete bundle[key]
        }
      }
    },
  }
}
