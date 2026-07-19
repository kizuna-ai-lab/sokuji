import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'path'
import fs from 'fs'
import pkg from './package.json' with { type: 'json' }
import { dropDuplicateOrtWasm } from './vite.drop-duplicate-ort-wasm'
import { workerManualChunks } from './vite.worker-chunks'

/**
 * Dev-only plugin: serve model-packs/tts/ files at /model-packs/tts/ URLs.
 * TTS model .data and package-metadata.json files live in model-packs/tts/wasm-*
 * and need to be accessible to the browser during development.
 */
function serveModelPacks(): Plugin {
  return {
    name: 'serve-model-packs',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/model-packs/tts/')) return next()
        const filePath = path.join(process.cwd(), decodeURIComponent(req.url))
        if (!fs.existsSync(filePath)) return next()
        const stat = fs.statSync(filePath)
        if (!stat.isFile()) return next()
        // Manual pipe bypasses server.headers — set isolation headers here too.
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
        res.setHeader('Content-Length', stat.size)
        if (filePath.endsWith('.json')) res.setHeader('Content-Type', 'application/json')
        else res.setHeader('Content-Type', 'application/octet-stream')
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

/**
 * Dev-only plugin: serve onnxruntime-web files from node_modules/onnxruntime-web/dist/.
 *
 * Handles two cases:
 * 1. Explicit wasmPaths requests from workers: /wasm/ort/ort-wasm-simd.wasm
 *    Workers set env.backends.onnx.wasm.wasmPaths = '/wasm/ort/' to load ORT
 *    runtime files. Vite's module transform rejects .mjs dynamic imports from
 *    public/, so this middleware serves them directly.
 *
 * 2. ORT dynamic imports from Vite's pre-bundled .vite/deps/:
 *    When onnxruntime-web is pre-bundled, ORT's runtime does
 *    import('./ort-wasm-simd.mjs') relative to the bundle output. Those sibling
 *    .mjs/.wasm files don't exist in .vite/deps/. This middleware catches them
 *    by filename pattern.
 */
function serveOrtWasm(): Plugin {
  return {
    name: 'serve-ort-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.replace(/\?.*$/, '') || ''
        let filename: string | null = null

        if (url.startsWith('/wasm/ort/')) {
          // Case 1: explicit wasmPaths from workers
          filename = decodeURIComponent(url.replace('/wasm/ort/', ''))
        } else {
          // Case 2: ORT dynamic imports from .vite/deps/ or other paths
          const match = url.match(/(ort-wasm[^/]*\.(?:mjs|js|wasm))$/)
          if (match) filename = match[1]
        }

        if (!filename) return next()
        const filePath = path.join(process.cwd(), 'node_modules/onnxruntime-web/dist', filename)
        if (!fs.existsSync(filePath)) return next()
        const stat = fs.statSync(filePath)
        if (!stat.isFile()) return next()
        // Manual pipe bypasses server.headers. Under isolation ORT goes
        // multi-threaded and loads its threaded runtime .mjs as nested pthread
        // worker scripts (need COEP); the .wasm needs CORP. Set both here.
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
        res.setHeader('Content-Length', stat.size)
        if (filename.endsWith('.mjs') || filename.endsWith('.js'))
          res.setHeader('Content-Type', 'application/javascript')
        else if (filename.endsWith('.wasm'))
          res.setHeader('Content-Type', 'application/wasm')
        else
          res.setHeader('Content-Type', 'application/octet-stream')
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

/**
 * Dev-only plugin: set cross-origin isolation headers on EVERY response.
 *
 * Electron 40's Chromium requires Cross-Origin-Embedder-Policy for ES module
 * workers even with SharedArrayBuffer from --enable-features. Vite's
 * `server.headers` does not reach all worker-script responses (notably `public/`
 * static workers via sirv, e.g. edge-tts.worker.js, and the `?worker_file`
 * handler for module workers like zoom-vad.worker.ts), so those load with
 * "COEP-framed resource needs COEP header". A top-of-stack middleware that
 * stamps the headers on every response covers them all. `serve` (dev) only;
 * the packaged app (file://) and the extension build are untouched.
 */
function crossOriginIsolationHeaders(): Plugin {
  return {
    name: 'cross-origin-isolation-headers',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
        next()
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory
  const env = loadEnv(mode, process.cwd(), '')
  const isServe = command === 'serve'
  const isBuild = command === 'build'
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG
  
  return {
    plugins: [
      isServe && crossOriginIsolationHeaders(),
      isServe && serveModelPacks(),
      isServe && serveOrtWasm(),
      react(),
      dropDuplicateOrtWasm(),
      electron({
        main: {
          // Entry points for the main process
          entry: {
            'better-auth-adapter': 'electron/better-auth-adapter.js',
            'macos-audio-utils': 'electron/macos-audio-utils.js',
            'main': 'electron/main.js',
            'native-host-manager': 'electron/native-host-manager.js',
            'sidecar-sku': 'electron/sidecar-sku.js',
            'sidecar-bundle': 'electron/sidecar-bundle.js',
            'pulseaudio-utils': 'electron/pulseaudio-utils.js',
            'windows-audio-utils': 'electron/windows-audio-utils.js',
            'vb-cable-installer': 'electron/vb-cable-installer.js',
            'squirrel-events': 'electron/squirrel-events.js',
            'subtitle-window': 'electron/subtitle-window.js',
            'update-manager': 'electron/update-manager.js'
          },
          onstart(args) {
            // Override default [".", "--no-sandbox"] to fix DevTools crash on Linux
            args.startup(["."])
          },
          vite: {
            build: {
              sourcemap,
              minify: isBuild,
              outDir: 'dist-electron',
              rollupOptions: {
                external: ['electron', 'electron-squirrel-startup', 'electron-conf', 'electron-audio-loopback', 'electron-updater'],
                output: {
                  entryFileNames: '[name].js'
                }
              }
            },
            define: {
              'import.meta.env.MODE': JSON.stringify(mode)
            }
          }
        },
        preload: {
          // Entry point for the preload script. It ESM-imports ipc-channels.js,
          // which the single-file preload build inlines into the shipped
          // preload.js (so the invoke allowlist stays an auditable literal in
          // the built artifact).
          input: 'electron/preload.js',
          vite: {
            build: {
              sourcemap: sourcemap ? 'inline' : undefined,
              minify: isBuild,
              outDir: 'dist-electron',
              rollupOptions: {
                external: ['electron']
              }
            }
          }
        },
        // Polyfill the Electron and Node.js built-in modules for renderer process
        renderer: {}
      })
    ],
    server: {
      port: 5173,
      host: true,
      watch: {
        // Vite recursively watches the whole project tree. Python virtualenvs
        // living under git worktrees (.claude/worktrees/**/.spike/venv — with
        // site-packages holding 100k+ files like onnx/torch) blow past the
        // inotify max_user_watches limit and crash the dev server with ENOSPC.
        // None of these dirs feed the build, so exclude them from the watcher.
        // Merged with Vite's defaults (node_modules, .git already ignored).
        ignored: [
          '**/.claude/worktrees/**',
          '**/.spike/**',
          '**/venv/**',
          '**/.venv/**',
          '**/__pycache__/**',
        ],
      },
      // Cross-origin isolation for the dev server (electron:dev / web dev only).
      // Electron 40's Chromium requires COEP for ES module workers even when SAB
      // comes from --enable-features=SharedArrayBuffer, so without these the
      // ORT/transformers/VAD module workers are blocked at load
      // ("COEP-framed resource needs COEP header"). Dev-server only — the packaged
      // app (file://) and the extension build (separate config) are untouched.
      // (The crossOriginIsolationHeaders plugin covers responses this misses.)
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    },
    build: {
      outDir: 'build',
      assetsDir: 'static',
      sourcemap: true
    },
    worker: {
      format: 'es',
      rollupOptions: {
        output: { manualChunks: workerManualChunks },
      },
    },
    base: './',
    define: {
      global: 'globalThis',
      // Define build target for Electron
      'import.meta.env.BUILD_TARGET': JSON.stringify('electron'),
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    css: {
      preprocessorOptions: {
        scss: {}
      }
    },
    optimizeDeps: {
      exclude: ['electron'],
      include: ['@huggingface/transformers', 'onnxruntime-web'],
    }
  }
})
