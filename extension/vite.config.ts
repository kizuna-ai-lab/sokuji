import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'
import fs from 'fs'

/**
 * Rollup emits ort-wasm-*.wasm into assets/ because onnxruntime-web uses
 * `new URL('...wasm', import.meta.url)`. Our workers override wasmPaths to
 * load from wasm/ort/ (copied via viteStaticCopy), so the assets/ copy is
 * never fetched at runtime. Drop it to avoid ~26 MB duplication.
 *
 * JSEP files (WebGPU/WebNN backend) are kept because ORT's JSEP backend
 * resolves WASM via the Vite-transformed import.meta.url path in assets/,
 * ignoring the wasmPaths override.
 */
function dropDuplicateOrtWasm(): Plugin {
  return {
    name: 'drop-duplicate-ort-wasm',
    generateBundle(_, bundle) {
      for (const key of Object.keys(bundle)) {
        if (key.includes('ort-wasm') && key.endsWith('.wasm') && !key.includes('jsep')) {
          delete bundle[key]
        }
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  // Load root .env so production builds pick up feature flags
  const rootEnvPath = path.resolve(__dirname, '../.env')
  const rootEnv: Record<string, string> = {}
  if (fs.existsSync(rootEnvPath)) {
    for (const line of fs.readFileSync(rootEnvPath, 'utf-8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue
      const key = trimmed.slice(0, eqIndex)
      const value = trimmed.slice(eqIndex + 1)
      rootEnv[key] = value
    }
  }

  const isDevMode = mode === 'development'

  // Resolve env values with fallbacks (matching webpack config behavior)
  const envVal = (key: string, fallback: string, devOverride?: string) => {
    if (isDevMode && devOverride !== undefined) return devOverride
    return rootEnv[key] || process.env[key] || fallback
  }

  return {
    plugins: [
      react(),
      dropDuplicateOrtWasm(),
      viteStaticCopy({
        targets: [
          // Content scripts and background (vanilla JS, no bundling needed)
          { src: 'background/background.js', dest: '.' },
          { src: 'content/content.js', dest: '.' },
          { src: 'content/zoom-content.js', dest: '.' },
          { src: 'content/site-plugins.js', dest: 'content' },
          { src: 'content/virtual-microphone.js', dest: 'content' },
          { src: 'content/device-emulator.iife.js', dest: 'content' },
          // Manifest, icons, locales
          { src: 'manifest.json', dest: '.' },
          { src: '_locales', dest: '.' },
          { src: 'icons', dest: '.' },
          // Worklets
          {
            src: '../src/services/worklets/pcm-audio-worklet-processor.js',
            dest: 'worklets',
          },
          {
            src: '../src/services/worklets/audio-recorder-worklet-processor.js',
            dest: 'worklets',
          },
          // Permission page
          { src: 'permission.html', dest: '.' },
          { src: 'requestPermission.js', dest: '.' },
          // Popup styles
          { src: 'popup.css', dest: '.' },
          // Bundled ONNX Runtime WASM (avoids cdn.jsdelivr.net CSP violation)
          { src: '../public/wasm/ort/*', dest: 'wasm/ort' },
          // Classic workers for ASR/TTS (sherpa-onnx uses importScripts, can't be ES modules)
          { src: '../public/workers/*', dest: 'workers' },
          // Silero VAD model (used by Whisper-WebGPU worker)
          { src: '../public/wasm/vad/*', dest: 'wasm/vad' },
          // sherpa-onnx WASM runtimes (loaded by workers via importScripts)
          { src: '../public/wasm/sherpa-onnx-asr/*', dest: 'wasm/sherpa-onnx-asr' },
          { src: '../public/wasm/sherpa-onnx-tts/*', dest: 'wasm/sherpa-onnx-tts' },
          { src: '../public/wasm/sherpa-onnx-asr-stream/*', dest: 'wasm/sherpa-onnx-asr-stream' },
          // Dev-only assets
          ...(isDevMode
            ? [{ src: '../public/assets/test-tone.mp3', dest: 'assets' }]
            : []),
        ],
      }),
    ],
    root: __dirname,
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: isDevMode ? 'inline' as const : false,
      minify: !isDevMode ? 'esbuild' as const : false,
      rollupOptions: {
        input: {
          fullpage: path.resolve(__dirname, 'fullpage.html'),
          popup: path.resolve(__dirname, 'popup.html'),
        },
        output: {
          // Stable filenames for manifest.json references
          entryFileNames: '[name].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      alias: {
        '@src': path.resolve(__dirname, '../src'),
        '@components': path.resolve(__dirname, '../src/components'),
        '@contexts': path.resolve(__dirname, '../src/contexts'),
        '@lib': path.resolve(__dirname, '../src/lib'),
        '@utils': path.resolve(__dirname, '../src/utils'),
      },
      dedupe: ['react', 'react-dom'],
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      'process.env.POSTHOG_KEY': JSON.stringify(envVal('POSTHOG_KEY', '')),
      'process.env.POSTHOG_HOST': JSON.stringify(
        envVal('POSTHOG_HOST', 'https://us.i.posthog.com')
      ),
      'import.meta.env.MODE': JSON.stringify(mode),
      'import.meta.env.VITE_BACKEND_URL': JSON.stringify(
        envVal('VITE_BACKEND_URL', '')
      ),
      'import.meta.env.VITE_ENABLE_KIZUNA_AI': JSON.stringify(
        envVal('VITE_ENABLE_KIZUNA_AI', 'false', 'true')
      ),
      'import.meta.env.VITE_ENABLE_PALABRA_AI': JSON.stringify(
        envVal('VITE_ENABLE_PALABRA_AI', 'false')
      ),
      'import.meta.env.VITE_ENABLE_VOLCENGINE_ST': JSON.stringify(
        envVal('VITE_ENABLE_VOLCENGINE_ST', 'false', 'true')
      ),
      'import.meta.env.VITE_ENABLE_VOLCENGINE_AST2': JSON.stringify(
        envVal('VITE_ENABLE_VOLCENGINE_AST2', 'false', 'true')
      ),
      'import.meta.env.VITE_POSTHOG_KEY': JSON.stringify(
        envVal('POSTHOG_KEY', '')
      ),
      'import.meta.env.VITE_POSTHOG_HOST': JSON.stringify(
        envVal('POSTHOG_HOST', 'https://us.i.posthog.com')
      ),
      'import.meta.env.DEV': JSON.stringify(isDevMode),
      global: 'globalThis',
    },
    css: {
      preprocessorOptions: {
        scss: {},
      },
    },
  }
})
