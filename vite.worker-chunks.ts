/**
 * Manual-chunk strategy for Vite worker builds, shared by the Electron
 * (root `vite.config.ts`) and browser-extension (`extension/vite.config.ts`)
 * builds.
 *
 * Buckets `@huggingface/transformers`, `onnxruntime-web`, and
 * `@ricky0123/vad-web` into named chunks so multiple workers in the same
 * build can share them. Combined with the side-effect "pin" shims under
 * `src/lib/local-inference/workers/_shared/`, this lets Vite deduplicate
 * ~6 MB of transformer / ORT code across the 12 worker bundles.
 *
 * Path matching uses `[\\/]` so it works under both POSIX and Windows
 * module IDs — on Windows Rollup hands us paths with backslashes, and a
 * plain `includes('node_modules/…')` check silently misses, regressing
 * Windows worker bundles to the un-shared layout.
 */
export function workerManualChunks(id: string): string | undefined {
  if (/[\\/]node_modules[\\/]@huggingface[\\/]transformers[\\/]/.test(id)) {
    return 'hf-transformers'
  }
  if (/[\\/]node_modules[\\/]onnxruntime-web[\\/]/.test(id)) {
    return 'onnxruntime-web'
  }
  if (/[\\/]node_modules[\\/]@ricky0123[\\/]vad-web[\\/]/.test(id)) {
    return 'vad-web'
  }
  return undefined
}
