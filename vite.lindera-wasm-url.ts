import type { Plugin } from 'vite'

const GLUE = 'lindera-wasm-ipadic-web/lindera_wasm.js'
const DEFAULT_URL = "new URL('lindera_wasm_bg.wasm', import.meta.url)"

/**
 * The Lindera glue names its 17 MB wasm (IPADIC inside) with
 * `new URL(…, import.meta.url)`, which Vite emits as an asset, or inlines in a
 * library build. The app instantiates it from bytes it downloaded once
 * (src/lib/reading/ja/dictionary.ts), so the reference is replaced with a throw.
 * Listed in `plugins` and in `worker.plugins`: the glue lives in a worker bundle.
 */
export function linderaWasmUrl(): Plugin {
  return {
    name: 'lindera-wasm-url',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').includes(GLUE)) return null
      if (!code.includes(DEFAULT_URL)) {
        throw new Error(`lindera-wasm-url: ${GLUE} no longer names its wasm as ${DEFAULT_URL}; update this plugin`)
      }
      return {
        code: code.replace(DEFAULT_URL, "(() => { throw new Error('The Lindera wasm is loaded from storage, never from the build') })()"),
        map: null,
      }
    },
  }
}
