import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'path'
import fs from 'fs'
import pkg from './package.json' with { type: 'json' }

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

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory
  const env = loadEnv(mode, process.cwd(), '')
  const isServe = command === 'serve'
  const isBuild = command === 'build'
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG
  
  return {
    plugins: [
      isServe && serveModelPacks(),
      isServe && serveOrtWasm(),
      react(),
      electron({
        main: {
          // Entry points for the main process
          entry: {
            'better-auth-adapter': 'electron/better-auth-adapter.js',
            'macos-audio-utils': 'electron/macos-audio-utils.js',
            'main': 'electron/main.js',
            'pulseaudio-utils': 'electron/pulseaudio-utils.js',
            'windows-audio-utils': 'electron/windows-audio-utils.js',
            'vb-cable-installer': 'electron/vb-cable-installer.js',
            'squirrel-events': 'electron/squirrel-events.js',
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
          // Entry point for the preload script
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
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    build: {
      outDir: 'build',
      assetsDir: 'static',
      sourcemap: true
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